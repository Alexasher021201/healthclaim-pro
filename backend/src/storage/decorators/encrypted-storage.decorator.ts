import * as crypto from 'crypto';
import { Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { IStorageService, StoragePutOptions } from '../interfaces/storage-service.interface';

export interface EncryptionResult {
  storageKey: string;
  encryptedDek: string;
  iv: string;
  authTag: string;
  checksum: string;
  magicHeader: string;
}

/**
 * Transparently wraps storage operations adhering to the Open-Closed Principle.
 * Encrypts payload with dynamic 32-byte DEK (AES-256-GCM) wrapped with Master Key,
 * frames into custom binary envelope with magic header 'HC_ENC',
 * and delegates persistence to underlying storage adapter.
 */
export class EncryptedStorageDecorator implements IStorageService {
  private readonly logger = new Logger(EncryptedStorageDecorator.name);
  private readonly magicHeader = 'HC_ENC';

  constructor(
    private readonly primaryStorage: IStorageService,
    private readonly fallbackStorage?: IStorageService,
    private readonly masterKey?: Buffer,
  ) {
    if (!this.masterKey) {
      const secret =
        process.env.MASTER_ENCRYPTION_KEY ||
        'healthclaim-pro-enterprise-zero-trust-master-key-2026';
      this.masterKey = crypto.createHash('sha256').update(secret).digest();
    }
  }

  /**
   * IStorageService interface implementation - stores pre-encrypted or raw buffer
   */
  async storeFile(buffer: Buffer, storageKey: string, options?: StoragePutOptions): Promise<void> {
    try {
      await this.primaryStorage.storeFile(buffer, storageKey, options);
    } catch (err: any) {
      if (this.fallbackStorage) {
        this.logger.warn(`Primary storage failed (${err.message}). Persisting to fallback storage.`);
        await this.fallbackStorage.storeFile(buffer, storageKey, options);
      } else {
        throw err;
      }
    }
  }

  /**
   * IStorageService interface implementation - retrieves file buffer
   */
  async retrieveFile(storageKey: string): Promise<Buffer> {
    try {
      return await this.primaryStorage.retrieveFile(storageKey);
    } catch (err: any) {
      if (this.fallbackStorage) {
        return await this.fallbackStorage.retrieveFile(storageKey);
      }
      throw err;
    }
  }

  async deleteFile(storageKey: string): Promise<void> {
    if (this.primaryStorage.deleteFile) {
      await this.primaryStorage.deleteFile(storageKey);
    }
    if (this.fallbackStorage?.deleteFile) {
      await this.fallbackStorage.deleteFile(storageKey);
    }
  }

  /**
   * High-level dual-key envelope encryption and persistence pipeline
   */
  async encryptAndStore(
    buffer: Buffer,
    originalFileName: string,
    mimeType: string,
  ): Promise<EncryptionResult> {
    // 1. Calculate SHA-256 integrity checksum
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // 2. Generate random 32-byte DEK and 12-byte IV
    const dek = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    // 3. Encrypt payload with AES-256-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // 4. Encrypt DEK with Master KEK
    const kekIv = crypto.randomBytes(12);
    const kekCipher = crypto.createCipheriv('aes-256-gcm', this.masterKey!, kekIv);
    const encryptedDekPayload = Buffer.concat([kekCipher.update(dek), kekCipher.final()]);
    const kekAuthTag = kekCipher.getAuthTag();
    const encryptedDek = `${kekIv.toString('hex')}:${kekAuthTag.toString('hex')}:${encryptedDekPayload.toString('hex')}`;

    // 5. Build binary framed envelope: [HC_ENC][version][IV][authTag][ciphertext]
    const headerBuffer = Buffer.from(this.magicHeader, 'utf8');
    const versionBuffer = Buffer.from([0x01]);
    const envelopeBuffer = Buffer.concat([
      headerBuffer,
      versionBuffer,
      iv,
      authTag,
      ciphertext,
    ]);

    // 6. Generate storage key and delegate persistence
    const datePrefix = new Date().toISOString().split('T')[0];
    const uniqueKey = `${datePrefix}-${crypto.randomBytes(16).toString('hex')}.enc`;

    await this.storeFile(envelopeBuffer, uniqueKey, {
      contentType: 'application/octet-stream',
      metadata: {
        'original-filename': encodeURIComponent(originalFileName),
        'checksum-sha256': checksum,
        'encrypted-algorithm': 'AES-256-GCM',
      },
    });

    return {
      storageKey: uniqueKey,
      encryptedDek,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      checksum,
      magicHeader: this.magicHeader,
    };
  }

  /**
   * Retrieves encrypted envelope and performs in-memory decryption and verification
   */
  async retrieveAndDecrypt(
    storageKey: string,
    encryptedDekString: string,
    expectedChecksum?: string,
  ): Promise<Buffer> {
    let envelopeBuffer: Buffer;
    try {
      envelopeBuffer = await this.retrieveFile(storageKey);
    } catch (err: any) {
      throw new BadRequestException(`Encrypted storage object '${storageKey}' not found: ${err.message}`);
    }

    // Validate envelope magic header
    const headerLength = 6;
    const magic = envelopeBuffer.subarray(0, headerLength).toString('utf8');
    if (magic !== this.magicHeader) {
      throw new InternalServerErrorException('Corrupted encryption envelope: invalid magic header.');
    }

    const version = envelopeBuffer[6];
    if (version !== 0x01) {
      throw new InternalServerErrorException(`Unsupported envelope encryption version: ${version}`);
    }

    const iv = envelopeBuffer.subarray(7, 19);
    const authTag = envelopeBuffer.subarray(19, 35);
    const ciphertext = envelopeBuffer.subarray(35);

    // Decrypt DEK using Master KEK
    const [kekIvHex, kekAuthTagHex, encryptedDekHex] = encryptedDekString.split(':');
    if (!kekIvHex || !kekAuthTagHex || !encryptedDekHex) {
      throw new InternalServerErrorException('Malformed encrypted DEK envelope metadata.');
    }

    const kekIv = Buffer.from(kekIvHex, 'hex');
    const kekAuthTag = Buffer.from(kekAuthTagHex, 'hex');
    const encryptedDekPayload = Buffer.from(encryptedDekHex, 'hex');

    const kekDecipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey!, kekIv);
    kekDecipher.setAuthTag(kekAuthTag);
    const dek = Buffer.concat([kekDecipher.update(encryptedDekPayload), kekDecipher.final()]);

    // Decrypt ciphertext using DEK
    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAuthTag(authTag);
    const plainBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    // Verify integrity checksum if provided
    if (expectedChecksum) {
      const computedChecksum = crypto.createHash('sha256').update(plainBuffer).digest('hex');
      if (computedChecksum !== expectedChecksum) {
        throw new InternalServerErrorException(
          'Integrity verification failed: decrypted payload SHA-256 checksum mismatch.',
        );
      }
    }

    return plainBuffer;
  }
}
