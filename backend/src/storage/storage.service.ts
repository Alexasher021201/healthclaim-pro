import {
  Injectable,
  Logger,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { S3Client } from '@aws-sdk/client-s3';
import { IStorageService, StoragePutOptions } from './interfaces/storage-service.interface';
import { S3BucketStorageAdapter } from './adapters/s3-bucket-storage.adapter';
import { LocalStorageFallbackAdapter } from './adapters/local-storage-fallback.adapter';
import {
  EncryptedStorageDecorator,
  EncryptionResult,
} from './decorators/encrypted-storage.decorator';

export { IStorageService, StoragePutOptions };
export { S3BucketStorageAdapter };
export { LocalStorageFallbackAdapter };
export { EncryptedStorageDecorator, EncryptionResult };

@Injectable()
export class StorageService implements IStorageService, OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly storageDir: string;
  private readonly masterKey: Buffer;
  private readonly magicHeader = 'HC_ENC';

  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private isS3Available = false;

  private readonly s3Adapter: S3BucketStorageAdapter;
  private readonly fallbackAdapter: LocalStorageFallbackAdapter;
  private readonly encryptedDecorator: EncryptedStorageDecorator;

  constructor() {
    this.storageDir = path.resolve(process.cwd(), 'uploads', 'receipts');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // Derive or load master key (32 bytes for AES-256-KW / KEK)
    const secret =
      process.env.MASTER_ENCRYPTION_KEY ||
      'healthclaim-pro-enterprise-zero-trust-master-key-2026';
    this.masterKey = crypto.createHash('sha256').update(secret).digest();

    this.bucketName = process.env.S3_BUCKET_NAME || 'healthclaim-receipts';
    const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
    const region = process.env.S3_REGION || 'us-east-1';
    const accessKeyId = process.env.S3_ACCESS_KEY || 'minioadmin';
    const secretAccessKey = process.env.S3_SECRET_KEY || 'minioadmin';

    this.s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });

    // Wire GoF Adapter & Decorator patterns
    this.s3Adapter = new S3BucketStorageAdapter(this.s3Client, this.bucketName);
    this.fallbackAdapter = new LocalStorageFallbackAdapter(this.storageDir);
    this.encryptedDecorator = new EncryptedStorageDecorator(
      this.s3Adapter,
      this.fallbackAdapter,
      this.masterKey,
    );
  }

  async onModuleInit() {
    await this.initS3Bucket();
  }

  /**
   * Initializes and ensures S3 / MinIO bucket exists
   */
  async initS3Bucket(): Promise<void> {
    const success = await this.s3Adapter.initBucket();
    this.isS3Available = success;
    if (success) {
      this.logger.log(`Connected to S3 / MinIO bucket '${this.bucketName}' successfully.`);
    } else {
      this.logger.warn(`MinIO S3 bucket initialization notice. Local storage fallback active.`);
    }
  }

  /**
   * Validate authentic file signatures (Magic Bytes) against spoofing
   */
  validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
    if (buffer.length < 4) return false;

    // PDF: %PDF- (0x25 0x50 0x44 0x46)
    if (mimeType === 'application/pdf') {
      return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    }

    // PNG: \x89PNG\r\n\x1a\n (0x89 0x50 0x4E 0x47)
    if (mimeType === 'image/png') {
      return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    }

    // JPEG / JPG: \xFF\xD8\xFF
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }

    // WebP: RIFF....WEBP
    if (mimeType === 'image/webp') {
      return (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer.toString('utf8', 8, 12) === 'WEBP'
      );
    }

    return false;
  }

  /**
   * Standard IStorageService persistence delegation
   */
  async storeFile(buffer: Buffer, storageKey: string, options?: StoragePutOptions): Promise<void> {
    return this.encryptedDecorator.storeFile(buffer, storageKey, options);
  }

  /**
   * Standard IStorageService retrieval delegation
   */
  async retrieveFile(storageKey: string): Promise<Buffer> {
    return this.encryptedDecorator.retrieveFile(storageKey);
  }

  /**
   * Encrypt file buffer using Dual-Key Envelope Encryption (AES-256-GCM + KEK)
   * Delegates through EncryptedStorageDecorator
   */
  async encryptAndStore(
    buffer: Buffer,
    originalFileName: string,
    mimeType: string,
  ): Promise<EncryptionResult> {
    if (!this.validateMagicBytes(buffer, mimeType)) {
      throw new BadRequestException(
        `File magic byte signature does not match declared MIME type '${mimeType}'. Potential file tampering or polyglot detected.`,
      );
    }

    return this.encryptedDecorator.encryptAndStore(buffer, originalFileName, mimeType);
  }

  /**
   * Decrypt file payload on the fly in memory with integrity & GCM Auth Tag verification
   * Delegates through EncryptedStorageDecorator
   */
  async retrieveAndDecrypt(
    storageKey: string,
    encryptedDekString: string,
    expectedChecksum?: string,
  ): Promise<Buffer> {
    return this.encryptedDecorator.retrieveAndDecrypt(storageKey, encryptedDekString, expectedChecksum);
  }

  /**
   * Delete stored encrypted envelope from MinIO S3 and local storage
   */
  async deleteStoredFile(storageKey: string): Promise<void> {
    return this.encryptedDecorator.deleteFile(storageKey);
  }
}
