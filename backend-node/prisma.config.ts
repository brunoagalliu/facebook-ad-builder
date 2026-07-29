import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer accepts a `url` in schema.prisma's datasource block for the CLI
// (migrate/studio) — the connection string for those commands lives here instead.
// The app itself connects via the driver adapter in src/core/prisma.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
