import { NextFunction, Request, Response } from "express";

// Ports main.py's `add_security_headers` middleware header-for-header.
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (req.protocol === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  next();
}
