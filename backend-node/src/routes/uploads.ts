import { Router } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";

import { uploadFile } from "../services/storage";

// No auth on this router, matching the Python source (uploads.py has zero auth deps).
const router = Router();

const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const ALLOWED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".webm"]);
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VIDEO_SIZE } });

router.post("", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ detail: "No file provided" });
      return;
    }

    // Security: sanitize filename to prevent path traversal, validate extension.
    const safeFilename = path.basename(file.originalname);
    const extension = path.extname(safeFilename).toLowerCase();
    const isVideo = ALLOWED_VIDEO_EXTENSIONS.has(extension);
    const isImage = ALLOWED_IMAGE_EXTENSIONS.has(extension);
    if (!isVideo && !isImage) {
      res.status(400).json({
        detail: `Invalid file type. Allowed types: ${[...ALLOWED_IMAGE_EXTENSIONS, ...ALLOWED_VIDEO_EXTENSIONS].join(", ")}`,
      });
      return;
    }

    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) {
      res.status(400).json({ detail: `File too large. Maximum size: ${maxSize / (1024 * 1024)}MB` });
      return;
    }

    const filename = `${randomUUID()}${extension}`;
    const url = await uploadFile(file.buffer, filename, file.mimetype || "application/octet-stream");

    res.json({ url, media_type: isVideo ? "video" : "image" });
  } catch (err) {
    res.status(500).json({ detail: `Could not upload file: ${(err as Error).message}` });
  }
});

export default router;
