import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";

import { settings } from "../core/config";

// Consolidates what the Python app duplicated independently in uploads.py and
// brand_scraper.py into a single storage service.

const uploadsDir = path.join(__dirname, "..", "..", "uploads");

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: settings.r2EndpointUrl,
      region: "auto",
      credentials: {
        accessKeyId: settings.R2_ACCESS_KEY_ID,
        secretAccessKey: settings.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

export const r2Enabled = settings.r2Enabled;

export async function uploadToR2(content: Buffer, filename: string, contentType: string): Promise<string> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: settings.R2_BUCKET_NAME,
      Key: filename,
      Body: content,
      ContentType: contentType,
    })
  );
  return `${settings.R2_PUBLIC_URL}/${filename}`;
}

export async function uploadToLocal(content: Buffer, filename: string): Promise<string> {
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(path.join(uploadsDir, filename), content);
  return `/uploads/${filename}`;
}

/** Uploads to R2 if configured, otherwise falls back to local disk. */
export async function uploadFile(content: Buffer, filename: string, contentType: string): Promise<string> {
  return r2Enabled ? uploadToR2(content, filename, contentType) : uploadToLocal(content, filename);
}

export async function deleteFromR2(objectUrl: string): Promise<void> {
  if (!objectUrl.startsWith(settings.R2_PUBLIC_URL)) return;
  const key = objectUrl.slice(settings.R2_PUBLIC_URL.length).replace(/^\//, "");
  await getS3Client().send(new DeleteObjectCommand({ Bucket: settings.R2_BUCKET_NAME, Key: key }));
}
