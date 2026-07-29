import rateLimit from "express-rate-limit";

// Ports core/rate_limit.py's slowapi Limiter (keyed by client IP). slowapi's per-route
// `@limiter.limit("N/minute")` decorators are ported per-route in the auth module (Phase B)
// using this same factory rather than one single global limit.
export function perMinuteLimiter(max: number) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "unknown",
  });
}
