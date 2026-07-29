/** Ports backend/app/services/scheduler_service.py: elapsed-time "is this due" checks
 * (not calendar-cron) over SavedSearch rows marked scheduled_daily/scheduled_weekly. */
import { prisma } from "../core/prisma";
import { searchAndSave } from "./researchService";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function isDue(search: { searchType: string; lastRun: Date | null }, now: Date): boolean {
  if (!search.lastRun) return true;
  if (search.searchType === "scheduled_daily") {
    return now.getTime() - search.lastRun.getTime() >= DAY_MS;
  }
  if (search.searchType === "scheduled_weekly") {
    return now.getTime() - search.lastRun.getTime() >= WEEK_MS;
  }
  return false;
}

export async function getDueSearches() {
  const now = new Date();
  const searches = await prisma.savedSearch.findMany({
    where: { searchType: { in: ["scheduled_daily", "scheduled_weekly"] }, isActive: true },
  });
  return searches.filter((s) => isDue(s, now));
}

export async function executeScheduledSearch(search: {
  id: string;
  query: string;
  country: string | null;
  negativeKeywords: unknown;
  verticalId: string | null;
  searchType: string;
}): Promise<void> {
  await searchAndSave({
    query: search.query,
    country: search.country || "US",
    negative_keywords: (search.negativeKeywords as string[] | null) ?? [],
    vertical_id: search.verticalId ?? undefined,
    limit: 100,
    offset: 0,
    exclude_ids: [],
    search_type: search.searchType,
  });

  await prisma.savedSearch.update({ where: { id: search.id }, data: { lastRun: new Date() } });
}

export async function runScheduledSearches(): Promise<void> {
  const dueSearches = await getDueSearches();
  if (dueSearches.length === 0) {
    console.log("No scheduled searches due");
    return;
  }
  console.log(`Found ${dueSearches.length} scheduled searches to run`);

  for (const search of dueSearches) {
    try {
      await executeScheduledSearch(search);
      console.log(`Successfully executed scheduled search: ${search.query}`);
    } catch (err) {
      console.error(`Error running scheduled search ${search.id}:`, err);
    }
  }
}
