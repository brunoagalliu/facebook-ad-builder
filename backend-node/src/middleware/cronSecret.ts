import { NextFunction, Request, Response } from "express";

import { settings } from "../core/config";

/** Guards POST /research/run-scheduled-searches, which the Python app left completely
 * unauthenticated (a public endpoint that triggers scraping + DB writes) — fixed here
 * per an explicit decision to add a shared-secret header rather than preserve the gap.
 * Whatever external service currently calls this route just needs to send this header. */
export function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  if (!settings.CRON_SECRET) {
    res.status(500).json({ detail: "CRON_SECRET not configured" });
    return;
  }
  if (req.headers["x-cron-secret"] !== settings.CRON_SECRET) {
    res.status(401).json({ detail: "Invalid or missing X-Cron-Secret header" });
    return;
  }
  next();
}
