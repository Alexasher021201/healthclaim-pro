import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  StorageService,
  LocalStorageFallbackAdapter,
  EncryptedStorageDecorator,
} from '../src/storage/storage.service';
import * as fs from 'fs';
import * as path from 'path';

describe('StorageService (Dual-Key Envelope Encryption & Magic Byte Verification)', () => {
  let service: StorageService;
  const createdKeys: string[] = [];

  beforeEach(async () => {
    service = new StorageService();
    await service.onModuleInit();
  });

  afterEach(async () => {
    for (const key of createdKeys) {
      await service.deleteStoredFile(key).catch(() => {});
    }
  });

  it('should accurately validate authentic PNG magic bytes', () => {
    // Valid PNG signature: \x89PNG\r\n\x1a\n
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(service.validateMagicBytes(validPng, 'image/png')).toBe(true);

    // Fake PNG (e.g. text file renamed to .png)
    const fakePng = Buffer.from('this is just a text file');
    expect(service.validateMagicBytes(fakePng, 'image/png')).toBe(false);
  });

  it('should accurately validate authentic PDF magic bytes', () => {
    // Valid PDF signature: %PDF-
    const validPdf = Buffer.from('%PDF-1.7 standard header');
    expect(service.validateMagicBytes(validPdf, 'application/pdf')).toBe(true);

    const fakePdf = Buffer.from('fake pdf stream');
    expect(service.validateMagicBytes(fakePdf, 'application/pdf')).toBe(false);
  });

  it('should accurately validate authentic JPEG and WebP magic bytes', () => {
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(service.validateMagicBytes(validJpeg, 'image/jpeg')).toBe(true);
    expect(service.validateMagicBytes(validJpeg, 'image/jpg')).toBe(true);

    const validWebp = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
    ]);
    expect(service.validateMagicBytes(validWebp, 'image/webp')).toBe(true);

    // Short buffer
    expect(service.validateMagicBytes(Buffer.from([0x01, 0x02]), 'image/png')).toBe(false);
    // Unsupported type
    expect(service.validateMagicBytes(validJpeg, 'audio/mp3')).toBe(false);
  });

  it('should reject unmatching magic bytes during encryptAndStore', async () => {
    const fakeBuffer = Buffer.from('fake data header');
    await expect(service.encryptAndStore(fakeBuffer, 'file.png', 'image/png')).rejects.toThrow(
      'File magic byte signature does not match declared MIME type',
    );
  });

  it('should encrypt, frame into binary envelope, and decrypt payload cleanly with SHA-256 match', async () => {
    const rawContent = '%PDF-1.5 \n Medical Invoice for Consultation \n Amount: $180.00 \n Clinic: Parkway';
    const plainBuffer = Buffer.from(rawContent, 'utf8');

    // 1. Encrypt and store
    const result = await service.encryptAndStore(plainBuffer, 'invoice_180.pdf', 'application/pdf');
    createdKeys.push(result.storageKey);

    expect(result.storageKey).toBeDefined();
    expect(result.storageKey.endsWith('.enc')).toBe(true);
    expect(result.magicHeader).toBe('HC_ENC');
    expect(result.checksum).toBeDefined();
    expect(result.encryptedDek).toBeDefined();

    // 2. Retrieve and decrypt in memory
    const decryptedBuffer = await service.retrieveAndDecrypt(
      result.storageKey,
      result.encryptedDek,
      result.checksum,
    );

    expect(decryptedBuffer.toString('utf8')).toBe(rawContent);
  });

  it('should reject tampered or corrupted ciphertext during decryption', async () => {
    const rawContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb]);
    const result = await service.encryptAndStore(rawContent, 'test.png', 'image/png');
    createdKeys.push(result.storageKey);

    // Wrong encryptedDek (tampered KEK)
    await expect(
      service.retrieveAndDecrypt(result.storageKey, 'bad:kek:data', result.checksum),
    ).rejects.toThrow();

    // Checksum mismatch
    await expect(
      service.retrieveAndDecrypt(result.storageKey, result.encryptedDek, 'mismatched-checksum'),
    ).rejects.toThrow('Integrity verification failed');
  });

  it('should throw when encrypted file is missing', async () => {
    await expect(
      service.retrieveAndDecrypt('non-existent-key.enc', 'iv:tag:dek'),
    ).rejects.toThrow();
  });
});

describe('GoF Patterns: Adapter & Decorator Pattern', () => {
  it('LocalStorageFallbackAdapter should persist and retrieve raw files to disk', async () => {
    const testDir = path.resolve(process.cwd(), 'uploads', 'test-adapter');
    const adapter = new LocalStorageFallbackAdapter(testDir);
    const testKey = 'test-file.txt';
    const testBuffer = Buffer.from('hello world from adapter');

    await adapter.storeFile(testBuffer, testKey);
    expect(adapter.hasFile(testKey)).toBe(true);

    const retrieved = await adapter.retrieveFile(testKey);
    expect(retrieved.toString('utf8')).toBe('hello world from adapter');

    await adapter.deleteFile(testKey);
    expect(adapter.hasFile(testKey)).toBe(false);

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('EncryptedStorageDecorator should transparently encrypt payloads before delegating to adapter', async () => {
    const testDir = path.resolve(process.cwd(), 'uploads', 'test-decorator');
    const adapter = new LocalStorageFallbackAdapter(testDir);
    const decorator = new EncryptedStorageDecorator(adapter);

    const plainText = '%PDF-1.4 encrypted invoice receipt sample';
    const plainBuffer = Buffer.from(plainText, 'utf8');

    const result = await decorator.encryptAndStore(plainBuffer, 'receipt.pdf', 'application/pdf');
    expect(result.storageKey).toBeDefined();

    // Verify raw content on disk is actually encrypted (contains HC_ENC and ciphertext, not plain text)
    const storedRaw = await adapter.retrieveFile(result.storageKey);
    expect(storedRaw.toString('utf8')).not.toContain('encrypted invoice receipt sample');
    expect(storedRaw.subarray(0, 6).toString('utf8')).toBe('HC_ENC');

    // Verify decorator decrypts cleanly
    const decrypted = await decorator.retrieveAndDecrypt(
      result.storageKey,
      result.encryptedDek,
      result.checksum,
    );
    expect(decrypted.toString('utf8')).toBe(plainText);

    await decorator.deleteFile(result.storageKey);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

