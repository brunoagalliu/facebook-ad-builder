// Cost/duration logging for AI ad generation (Kie.ai image+video, Fal.ai image
// fallback), plus live balance lookups for the same two providers. A balance check
// failing must never break the actual generation — every function here swallows its
// own errors and returns a null/partial result instead of throwing.
import { Prisma } from "@prisma/client";

import { prisma } from "../core/prisma";
import { settings } from "../core/config";

export interface ProviderBalance {
  provider: "kie" | "fal";
  balance: number | null;
  unit: string;
  error?: string;
}

export async function getKieBalance(): Promise<ProviderBalance> {
  if (!settings.KIE_AI_API_KEY) {
    return { provider: "kie", balance: null, unit: "credits", error: "KIE_AI_API_KEY not configured" };
  }
  try {
    const response = await fetch("https://api.kie.ai/api/v1/chat/credit", {
      headers: { Authorization: `Bearer ${settings.KIE_AI_API_KEY}` },
    });
    const data = (await response.json()) as { code: number; msg: string; data?: number };
    if (!response.ok || data.code !== 200 || typeof data.data !== "number") {
      return { provider: "kie", balance: null, unit: "credits", error: data.msg || `status ${response.status}` };
    }
    return { provider: "kie", balance: data.data, unit: "credits" };
  } catch (err) {
    return { provider: "kie", balance: null, unit: "credits", error: (err as Error).message };
  }
}

export async function getFalBalance(): Promise<ProviderBalance> {
  // The billing endpoint requires an Admin-scope key — the regular FAL_AI_API_KEY
  // used for generation is API-scoped and 403s here (confirmed live).
  const key = settings.FAL_AI_ADMIN_KEY || settings.FAL_AI_API_KEY;
  if (!key) {
    return { provider: "fal", balance: null, unit: "usd", error: "FAL_AI_ADMIN_KEY not configured" };
  }
  try {
    const response = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
      headers: { Authorization: `Key ${key}` },
    });
    if (!response.ok) {
      return { provider: "fal", balance: null, unit: "usd", error: `status ${response.status}` };
    }
    // Confirmed live: { username, credits: { current_balance, currency } }.
    const data = (await response.json()) as { credits?: { current_balance?: number } };
    const balance = data.credits?.current_balance ?? null;
    if (balance === null) {
      return { provider: "fal", balance: null, unit: "usd", error: "Unexpected response shape" };
    }
    return { provider: "fal", balance, unit: "usd" };
  } catch (err) {
    return { provider: "fal", balance: null, unit: "usd", error: (err as Error).message };
  }
}

export async function getAllBalances(): Promise<ProviderBalance[]> {
  return Promise.all([getKieBalance(), getFalBalance()]);
}

async function getBalance(provider: "kie" | "fal"): Promise<number | null> {
  const result = provider === "kie" ? await getKieBalance() : await getFalBalance();
  return result.balance;
}

// Synchronous path: image generation resolves within a single call (Kie.ai's own
// createTask/recordInfo polling happens inside `run`, or a plain Fal SDK call).
export async function logImageGeneration<T>(params: {
  provider: "kie" | "fal";
  model: string;
  brandId?: string;
  run: () => Promise<T>;
}): Promise<T> {
  const { provider, model, brandId, run } = params;
  const balanceBefore = await getBalance(provider);
  const start = Date.now();
  const startedAt = new Date(start);

  try {
    const result = await run();
    // Fal's billing endpoint's realtime-ness for single-call diffing is unconfirmed,
    // and Fal is a rarely-hit fallback path here — recording a possibly-wrong cost is
    // worse than recording "unknown", so only Kie.ai gets a computed costAmount.
    const balanceAfter = await getBalance(provider);
    const costAmount = provider === "kie" && balanceBefore !== null && balanceAfter !== null ? balanceBefore - balanceAfter : null;
    await prisma.aiGenerationLog
      .create({
        data: {
          mediaType: "image",
          provider,
          model,
          status: "success",
          brandId,
          balanceBefore,
          balanceAfter,
          costAmount,
          durationMs: Date.now() - start,
          startedAt,
          completedAt: new Date(),
        },
      })
      .catch((err) => console.error("Failed to write AiGenerationLog:", err));
    return result;
  } catch (err) {
    await prisma.aiGenerationLog
      .create({
        data: {
          mediaType: "image",
          provider,
          model,
          status: "error",
          brandId,
          balanceBefore,
          durationMs: Date.now() - start,
          startedAt,
          errorMessage: (err as Error).message,
          completedAt: new Date(),
        },
      })
      .catch((logErr) => console.error("Failed to write AiGenerationLog:", logErr));
    throw err;
  }
}

// Async path: Kie.ai video generation returns a taskId quickly and completes later,
// detected by the frontend polling GET /generate-video/:taskId. Rows sit at
// status="pending" between startVideoGenerationLog and the eventual finalize call.
export async function startVideoGenerationLog(params: { model: string; brandId?: string; metadata?: Record<string, unknown> }): Promise<string> {
  const balanceBefore = await getBalance("kie");
  const log = await prisma.aiGenerationLog.create({
    data: {
      mediaType: "video",
      provider: "kie",
      model: params.model,
      status: "pending",
      brandId: params.brandId,
      balanceBefore,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
  return log.id;
}

export async function attachTaskId(logId: string, taskId: string): Promise<void> {
  await prisma.aiGenerationLog.update({ where: { id: logId }, data: { taskId } }).catch((err) => console.error("Failed to attach taskId to AiGenerationLog:", err));
}

// Resolves our own id (returned to the frontend as "task_id" — see createVideoTask) to
// whichever real Kie.ai job is currently in flight for this generation. Long-video mode
// re-points a single row at a second, later-created Kie.ai task via attachTaskId once
// segment 1 finishes, so "the id the frontend polls by" and "the current real taskId"
// are deliberately different things — this is the lookup that bridges them.
export async function getLogById(logId: string): Promise<{ taskId: string | null; metadata: Record<string, unknown> | null; status: string } | null> {
  try {
    const log = await prisma.aiGenerationLog.findUnique({ where: { id: logId } });
    if (!log) return null;
    return { taskId: log.taskId, metadata: log.metadata as Record<string, unknown> | null, status: log.status };
  } catch (err) {
    console.error("Failed to read AiGenerationLog by id:", err);
    return null;
  }
}

export async function updateLogMetadata(logId: string, metadata: Record<string, unknown>): Promise<void> {
  await prisma.aiGenerationLog
    .update({ where: { id: logId }, data: { metadata: metadata as Prisma.InputJsonValue } })
    .catch((err) => console.error("Failed to update AiGenerationLog metadata:", err));
}

// Read-only lookup for data stashed at task-creation time (e.g. cutaway overlay plans)
// that the poll route needs before it finalizes the row — best-effort, never throws,
// since a lookup failure should degrade to "no plan" rather than break the download.
export async function getLogMetadataByTaskId(taskId: string): Promise<Record<string, unknown> | null> {
  try {
    const log = await prisma.aiGenerationLog.findFirst({ where: { taskId } });
    return (log?.metadata as Record<string, unknown> | null) ?? null;
  } catch (err) {
    console.error("Failed to read AiGenerationLog metadata:", err);
    return null;
  }
}

// Guarded by status="pending" in the WHERE clause — a re-poll after completion (or a
// duplicate finalize call) matches 0 rows and silently no-ops instead of double-writing.
export async function finalizeVideoGenerationLog(taskId: string, outcome: { status: "success" | "error"; errorMessage?: string }): Promise<void> {
  try {
    const pending = await prisma.aiGenerationLog.findFirst({ where: { taskId, status: "pending" } });
    if (!pending) return;
    const balanceAfter = await getBalance("kie");
    const costAmount = pending.balanceBefore !== null && balanceAfter !== null ? pending.balanceBefore - balanceAfter : null;
    await prisma.aiGenerationLog.updateMany({
      where: { taskId, status: "pending" },
      data: {
        status: outcome.status,
        errorMessage: outcome.errorMessage,
        balanceAfter,
        costAmount,
        durationMs: Date.now() - pending.startedAt.getTime(),
        completedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("Failed to finalize AiGenerationLog:", err);
  }
}

// For the case createTask itself throws before a taskId was ever assigned.
export async function finalizeVideoGenerationLogById(logId: string, outcome: { status: "error"; errorMessage: string }): Promise<void> {
  try {
    const pending = await prisma.aiGenerationLog.findUnique({ where: { id: logId } });
    if (!pending || pending.status !== "pending") return;
    await prisma.aiGenerationLog.update({
      where: { id: logId },
      data: {
        status: outcome.status,
        errorMessage: outcome.errorMessage,
        durationMs: Date.now() - pending.startedAt.getTime(),
        completedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("Failed to finalize AiGenerationLog by id:", err);
  }
}
