import { Router } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";

import { asyncHandler } from "../middleware/asyncHandler";
import { requirePermission } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { perMinuteLimiter } from "../core/rateLimit";
import { screenshotSchema } from "../schemas/upload";
import { captureLandingPageScreenshot } from "../services/screenshotService";
import { uploadFile } from "../services/storage";

// No auth on the plain file-upload route below, matching the Python source
// (uploads.py has zero auth deps). The /screenshot route added after it is different:
// it makes the server fetch an arbitrary user-supplied URL, a materially different
// risk profile than accepting a file body, so it's gated and rate-limited unlike its
// sibling.
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

// Screenshots a user-supplied landing page (e.g. a product's real signup form) and
// uploads the result — same {url, media_type} response shape as the plain file-upload
// route above, so the frontend can push it into product_shots with zero
// special-casing. requirePermission mirrors what already gates product create/update
// (capturing a screenshot destined for product_shots is conceptually the same
// capability); perMinuteLimiter is independent defense-in-depth since each call
// launches a full headless Chromium process, unlike the plain multer route beside it.
router.post(
  "/screenshot",
  perMinuteLimiter(10),
  requirePermission("products:write"),
  validateBody(screenshotSchema),
  asyncHandler(async (req, res) => {
    const { url } = req.body as { url: string };

    let buffer: Buffer;
    try {
      buffer = await captureLandingPageScreenshot(url);
    } catch (err) {
      res.status(400).json({ detail: `Could not capture screenshot: ${(err as Error).message}` });
      return;
    }

    const uploadedUrl = await uploadFile(buffer, `${randomUUID()}.jpg`, "image/jpeg");
    res.json({ url: uploadedUrl, media_type: "image" });
  })
);

export default router;
