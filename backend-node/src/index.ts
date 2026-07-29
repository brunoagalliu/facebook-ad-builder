import { createApp } from "./app";
import { settings } from "./core/config";
import { prisma } from "./core/prisma";

function sanitizeDatabaseUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

async function main(): Promise<void> {
  try {
    const result = await prisma.$queryRawUnsafe<{ version: string }[]>("SELECT version()");
    console.log("Database connection OK:", result[0]?.version);
  } catch (err) {
    console.error(
      `Failed to connect to database at ${sanitizeDatabaseUrl(settings.DATABASE_URL)}:`,
      err
    );
    process.exit(1);
  }

  const app = createApp();
  const port = Number(process.env.PORT ?? 8000);
  app.listen(port, "0.0.0.0", () => {
    console.log(`Facebook Ad Automation API listening on port ${port}`);
  });
}

main();
