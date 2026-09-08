export interface StoragePutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

/**
 * Standard Storage Service interface decoupling domain logic from concrete cloud storage SDKs.
 * Implemented by concrete adapters (e.g. S3BucketStorageAdapter, LocalStorageFallbackAdapter)
 * and wrapped by decorators (e.g. EncryptedStorageDecorator).
 */
export interface IStorageService {
  storeFile(buffer: Buffer, storageKey: string, options?: StoragePutOptions): Promise<void>;
  retrieveFile(storageKey: string): Promise<Buffer>;
  deleteFile?(storageKey: string): Promise<void>;
}
