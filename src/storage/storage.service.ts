import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Readable } from "node:stream";
import type { Response } from "express";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export interface StreamOptions {
  contentType?: string;
  disposition: "inline" | "attachment";
  fileName?: string;
}

const LOCAL_ROOT = path.join(process.cwd(), "uploads");

// One storage abstraction shared by Documents, Contract documents, and Blog images/video —
// previously each had its own local-disk fs.* calls. Keys are plain forward-slash-joined
// strings (not real filesystem paths), stored as-is in the DB (DocumentVersion.storagePath,
// ContractDocument.storagePath, BlogPost.imagePath/videoPath) — existing rows keep resolving
// correctly under local disk even after S3 is configured, since only *new* writes go to S3.
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null = null;
  private readonly bucket: string | null = null;

  constructor(config: ConfigService) {
    const bucket = config.get<string>("S3_BUCKET");
    const region = config.get<string>("S3_REGION");
    const accessKeyId = config.get<string>("S3_ACCESS_KEY_ID");
    const secretAccessKey = config.get<string>("S3_SECRET_ACCESS_KEY");
    const endpoint = config.get<string>("S3_ENDPOINT");
    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      this.logger.warn("S3 storage is not configured — falling back to local disk (uploads/)");
      return;
    }
    this.bucket = bucket;
    this.client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  async write(key: string, buffer: Buffer): Promise<void> {
    if (this.client && this.bucket) {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer }));
      return;
    }
    const fullPath = path.join(LOCAL_ROOT, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
  }

  async streamToResponse(key: string, res: Response, opts: StreamOptions): Promise<void> {
    if (opts.contentType) res.type(opts.contentType);
    const name = opts.fileName ?? key.split("/").pop() ?? "download";
    res.setHeader(
      "Content-Disposition",
      `${opts.disposition}; filename="${name.replace(/"/g, "")}"`,
    );

    if (this.client && this.bucket) {
      try {
        const result = await this.client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        (result.Body as Readable).pipe(res);
        return;
      } catch (err) {
        // Files uploaded before S3 was configured still live on local disk — fall through to it.
        this.logger.warn(`S3 read failed for "${key}", trying local disk: ${(err as Error).name}`);
      }
    }

    const fullPath = path.join(LOCAL_ROOT, key);
    try {
      await fs.access(fullPath);
    } catch {
      this.logger.warn(`Storage file not found: ${key}`);
      throw new NotFoundException("File is missing from storage");
    }
    // `root` keeps send's dotfile check off the deploy path (a ".dir" parent would otherwise 404).
    res.sendFile(key, { root: LOCAL_ROOT });
  }

  async delete(key: string): Promise<void> {
    if (this.client && this.bucket) {
      await this.client
        .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
        .catch(() => {});
      return;
    }
    await fs.rm(path.join(LOCAL_ROOT, key), { force: true });
  }
}
