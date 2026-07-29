import cron from "node-cron";

import { runScheduledSearches } from "../services/schedulerService";

/** In-process scheduler: checks every 15 minutes whether any scheduled_daily/
 * scheduled_weekly SavedSearch is due (elapsed-time based, per schedulerService's
 * is-due logic — not calendar-cron), independent of the HTTP trigger route which
 * stays available too for whatever external pinger currently calls it. */
export function startScheduledSearchCron(): void {
  cron.schedule("*/15 * * * *", () => {
    runScheduledSearches().catch((err) => console.error("Scheduled search cron run failed:", err));
  });
}
