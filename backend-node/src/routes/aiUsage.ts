import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { getAllBalances } from "../services/aiUsageService";

const router = Router();

router.get(
  "/balances",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ balances: await getAllBalances() });
  })
);

function serializeLog(log: {
  id: string;
  mediaType: string;
  provider: string;
  model: string;
  status: string;
  taskId: string | null;
  brandId: string | null;
  generatedAdId: string | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  costAmount: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  brand?: { name: string } | null;
}) {
  return {
    id: log.id,
    media_type: log.mediaType,
    provider: log.provider,
    model: log.model,
    status: log.status,
    task_id: log.taskId,
    brand_id: log.brandId,
    brand_name: log.brand?.name ?? null,
    generated_ad_id: log.generatedAdId,
    balance_before: log.balanceBefore,
    balance_after: log.balanceAfter,
    cost_amount: log.costAmount,
    duration_ms: log.durationMs,
    error_message: log.errorMessage,
    started_at: log.startedAt.toISOString(),
    completed_at: log.completedAt ? log.completedAt.toISOString() : null,
  };
}

router.get(
  "/logs",
  requireAuth,
  asyncHandler(async (req, res) => {
    // Opportunistic self-heal: a client that stops polling mid-generation (tab closed)
    // would otherwise leave a row "pending" forever — sweep stale ones on read instead
    // of running a dedicated cron for it.
    await prisma.aiGenerationLog.updateMany({
      where: { status: "pending", startedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
      data: { status: "error", errorMessage: "Timed out waiting for terminal state", completedAt: new Date() },
    });

    const skip = Number(req.query.skip ?? 0);
    const limit = Number(req.query.limit ?? 50);
    const mediaType = req.query.media_type as string | undefined;
    const provider = req.query.provider as string | undefined;
    const status = req.query.status as string | undefined;
    const brandId = req.query.brand_id as string | undefined;

    const where = {
      ...(mediaType ? { mediaType } : {}),
      ...(provider ? { provider } : {}),
      ...(status ? { status } : {}),
      ...(brandId ? { brandId } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.aiGenerationLog.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip,
        take: limit,
        include: { brand: { select: { name: true } } },
      }),
      prisma.aiGenerationLog.count({ where }),
    ]);

    res.json({ logs: logs.map(serializeLog), total });
  })
);

router.get(
  "/summary",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [total, success, error, pending, kieCost, avgDuration] = await Promise.all([
      prisma.aiGenerationLog.count(),
      prisma.aiGenerationLog.count({ where: { status: "success" } }),
      prisma.aiGenerationLog.count({ where: { status: "error" } }),
      prisma.aiGenerationLog.count({ where: { status: "pending" } }),
      prisma.aiGenerationLog.aggregate({ where: { provider: "kie", costAmount: { not: null } }, _sum: { costAmount: true } }),
      prisma.aiGenerationLog.aggregate({ where: { durationMs: { not: null } }, _avg: { durationMs: true } }),
    ]);

    const byProvider = await prisma.aiGenerationLog.groupBy({
      by: ["provider", "mediaType"],
      _count: { _all: true },
    });

    res.json({
      total,
      success,
      error,
      pending,
      success_rate: total > 0 ? success / total : null,
      total_kie_credits_spent: kieCost._sum.costAmount,
      avg_duration_ms: avgDuration._avg.durationMs,
      by_provider: byProvider.map((row) => ({
        provider: row.provider,
        media_type: row.mediaType,
        count: row._count._all,
      })),
    });
  })
);

export default router;
