/** Ports backend/app/services/rate_limiter.py. A DB-backed rolling window over
 * SearchLog.apiCallsMade — not a request counter, but actual downstream Facebook
 * Graph API call volume, kept safely under Meta's hourly quota (59, not 60, minutes). */
import { prisma } from "../core/prisma";

const MAX_CALLS = 200;
const WINDOW_MINUTES = 59;

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

async function totalCallsInWindow(windowStart: Date): Promise<number> {
  const result = await prisma.searchLog.aggregate({
    _sum: { apiCallsMade: true },
    where: { createdAt: { gte: windowStart } },
  });
  return result._sum.apiCallsMade ?? 0;
}

async function resetSecondsFor(windowStart: Date, now: Date): Promise<number> {
  const oldest = await prisma.searchLog.findFirst({
    where: { createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
  });
  if (!oldest) return 0;
  const resetTime = new Date(oldest.createdAt.getTime() + WINDOW_MINUTES * 60_000);
  return Math.max(0, Math.round((resetTime.getTime() - now.getTime()) / 1000));
}

export async function checkLimit(): Promise<RateLimitCheck> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MINUTES * 60_000);

  const totalCalls = await totalCallsInWindow(windowStart);
  const remaining = Math.max(0, MAX_CALLS - totalCalls);
  const resetSeconds = totalCalls >= MAX_CALLS ? await resetSecondsFor(windowStart, now) : 0;

  return { allowed: totalCalls < MAX_CALLS, remaining, resetSeconds };
}

export async function getUsageStats(): Promise<{
  limit: number;
  used: number;
  remaining: number;
  reset_in_seconds: number;
  window_minutes: number;
}> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MINUTES * 60_000);

  const totalCalls = await totalCallsInWindow(windowStart);
  const remaining = Math.max(0, MAX_CALLS - totalCalls);
  const resetSeconds = totalCalls > 0 ? await resetSecondsFor(windowStart, now) : 0;

  return {
    limit: MAX_CALLS,
    used: totalCalls,
    remaining,
    reset_in_seconds: resetSeconds,
    window_minutes: WINDOW_MINUTES,
  };
}
