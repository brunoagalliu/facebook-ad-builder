// Gemini's own hosted models routinely return a transient 503 ("currently
// experiencing high demand") under normal load — confirmed live hitting this on both
// image and video blueprint deconstruction — with no retry anywhere in this codebase,
// so a single bad moment permanently loses that ad's blueprint (the WinningAd row
// itself still gets created and saved; only the AI analysis step fails). Retrying a
// couple of times with a short backoff turns a fully transient failure into a
// non-issue instead of surfacing it to the user as "missing."
export async function withTransientRetry<T>(fn: () => Promise<T>, options: { retries?: number; delayMs?: number } = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 2000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = (err as Error).message ?? "";
      const isTransient = /503|overloaded|high demand|429|rate limit/i.test(message);
      if (!isTransient || attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}
