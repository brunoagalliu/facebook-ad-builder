import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { settings } from "./config";

// Prisma 7 requires an explicit driver adapter rather than reading the connection
// string out of schema.prisma. Prisma still manages its own pooling on top of the
// adapter's pg Pool, so — as with previous Prisma versions — there is no per-request
// open/close needed here (unlike FastAPI's `Depends(get_db)` SQLAlchemy session);
// import this client directly in route/service modules.
const adapter = new PrismaPg({ connectionString: settings.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
