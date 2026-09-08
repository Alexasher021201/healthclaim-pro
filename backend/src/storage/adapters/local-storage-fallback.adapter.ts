import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { IStorageService } from '../interfaces/storage-service.interface';

/**
 * Secondary adapter persisting files to local disk when object storage is unreachable.
 */
export class LocalStorageFallbackAdapter implements IStorageService {
  private readonly logger = new Logger(LocalStorageFallbackAdapter.name);

  constructor(private readonly storageDir: string) {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async storeFile(buffer: Buffer, storageKey: string): Promise<void> {
    const fullPath = path.join(this.storageDir, storageKey);
    await fs.promises.writeFile(fullPath, buffer);
  }

  async retrieveFile(storageKey: string): Promise<Buffer> {
    const fullPath = path.join(this.storageDir, storageKey);
    if (fs.existsSync(fullPath)) {
      return await fs.promises.readFile(fullPath);
    }
    throw new Error(`Storage object '${storageKey}' not found on local disk.`);
  }

  async deleteFile(storageKey: string): Promise<void> {
    const fullPath = path.join(this.storageDir, storageKey);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath).catch(() => {});
    }
  }

  hasFile(storageKey: string): boolean {
    const fullPath = path.join(this.storageDir, storageKey);
    return fs.existsSync(fullPath);
  }
}
