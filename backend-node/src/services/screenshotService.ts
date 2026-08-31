/**
 * Screenshots an arbitrary user-supplied landing page (e.g. a product's real signup
 * form) so it can be used as a reference image for AI image/video generation — see
 * routes/uploads.ts's POST /screenshot. Kept separate from brandScraperService.ts
 * deliberately: that file's Playwright functions all navigate to Facebook's own pages
 * (including a live FB-login flow); this navigates to a third-party URL a user typed
 * in, which needs real SSRF validation none of those functions have needed before.
 */
import dns from "dns/promises";
import net from "net";
import { chromium } from "playwright";

// A real mobile Safari UA, not brandScraperService.ts's shared desktop UA_AGENT —
// pairing a mobile viewport with a desktop UA is exactly what makes UA-sniffing
// landing pages (common for lead-gen funnels) serve the desktop layout anyway,
// defeating the point of emulating mobile.
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const NAV_TIMEOUT_MS = 30_000;
// Lead-gen/testimonial-heavy landing pages routinely stitch to 10-20k px tall with a
// naive fullPage screenshot — wasted bytes, and an aspect ratio reference-image inputs
// aren't built for (the actual form becomes an illegible sliver once downscaled).
const MAX_CAPTURE_HEIGHT_PX = 6000;
const VIEWPORT = { width: 390, height: 844 }; // iPhone-sized

export async function captureLandingPageScreenshot(targetUrl: string): Promise<Buffer> {
  await assertPublicUrl(targetUrl); // fail fast before paying for a browser launch

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, userAgent: MOBILE_USER_AGENT });
    const page = await context.newPage();

    // Defense-in-depth against redirect-based SSRF (an open redirect on the target
    // site, or the target itself 302ing somewhere internal) — validate every request
    // the page actually makes, not just the URL the caller supplied up front.
    await page.route("**/*", async (route) => {
      try {
        await assertPublicUrl(route.request().url());
        await route.continue();
      } catch {
        await route.abort();
      }
    });

    // "networkidle" is too strict for real-world marketing/lead-gen pages — confirmed
    // live against turbodebt.com (the actual motivating example for this feature): it
    // timed out at 30s waiting for network idle, almost certainly due to persistent
    // background requests (analytics, chat widgets, ad-pixel polling) that never let
    // the network go fully quiet. "load" (the page's load event) plus a short fixed
    // settle time is the standard fallback for exactly this class of page.
    await page.goto(targetUrl, { timeout: NAV_TIMEOUT_MS, waitUntil: "load" });
    await page.waitForTimeout(2000);

    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    const options =
      scrollHeight > MAX_CAPTURE_HEIGHT_PX
        ? { clip: { x: 0, y: 0, width: VIEWPORT.width, height: MAX_CAPTURE_HEIGHT_PX } }
        : { fullPage: true };

    return await page.screenshot({ ...options, type: "jpeg" as const, quality: 85 });
  } finally {
    await browser.close();
  }
}

/** Rejects non-http(s) protocols and any hostname resolving to a private/reserved IP —
 * closes off the realistic threat here (pointing this at the cloud metadata endpoint,
 * localhost, or an internal Railway address). Has an honest limitation: this is a
 * DNS-rebinding gap in principle (the IP validated at lookup time isn't provably the
 * one Chromium's own resolver connects to moments later) — there's no existing
 * precedent in this codebase for a stronger pinned-resolution approach, and the
 * per-request page.route() check above is the practical mitigation available without
 * new infrastructure. Not a nation-state-grade guarantee; good enough for this app's
 * actual threat model. */
async function assertPublicUrl(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error(`Blocked host: ${hostname}`);
  }

  const addresses = net.isIP(hostname) ? [hostname] : (await dns.lookup(hostname, { all: true })).map((a) => a.address);
  for (const ip of addresses) {
    if (isPrivateOrReservedIp(ip)) throw new Error(`Blocked address: ${ip}`);
  }
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 127 || // loopback
      a === 10 || // RFC1918
      (a === 172 && b >= 16 && b <= 31) || // RFC1918
      (a === 192 && b === 168) || // RFC1918
      (a === 169 && b === 254) || // link-local — covers the 169.254.169.254 cloud
      // metadata endpoint, the single highest-value SSRF target on Railway/AWS/GCP
      a === 0 // "this network"
    );
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return (
      normalized === "::1" || // loopback
      normalized.startsWith("fc") || // fc00::/7 unique local
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80") || // link-local
      normalized.startsWith("::ffff:") // IPv4-mapped — re-check the embedded IPv4
    );
  }
  return false;
}
