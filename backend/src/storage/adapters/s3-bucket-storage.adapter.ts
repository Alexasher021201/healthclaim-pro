import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { IStorageService, StoragePutOptions } from '../interfaces/storage-service.interface';

/**
 * Concrete adapter implementing AWS S3 / MinIO API integration via @aws-sdk/client-s3.
 */
export class S3BucketStorageAdapter implements IStorageService {
  private readonly logger = new Logger(S3BucketStorageAdapter.name);

  constructor(
    private readonly s3Client: S3Client,
    private readonly bucketName: string,
  ) {}

  async storeFile(buffer: Buffer, storageKey: string, options?: StoragePutOptions): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: storageKey,
        Body: buffer,
        ContentType: options?.contentType || 'application/octet-stream',
        Metadata: options?.metadata,
      }),
    );
  }

  async retrieveFile(storageKey: string): Promise<Buffer> {
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: storageKey,
      }),
    );
    const byteArray = await response.Body?.transformToByteArray();
    if (!byteArray) {
      throw new Error(`Empty S3 response stream for key: ${storageKey}`);
    }
    return Buffer.from(byteArray);
  }

  async deleteFile(storageKey: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: storageKey,
        }),
      );
    } catch (err: any) {
      this.logger.warn(`Could not delete object from S3 bucket: ${err.message}`);
    }
  }

  async initBucket(): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      return true;
    } catch (err: any) {
      try {
        await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
        return true;
      } catch (createErr: any) {
        this.logger.warn(`MinIO S3 bucket initialization notice: ${createErr.message}`);
        return false;
      }
    }
  }
}
