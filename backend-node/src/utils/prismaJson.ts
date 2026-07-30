import { Prisma } from "@prisma/client";

/** Prisma requires its own `DbNull` sentinel for a JSON column's value, not a plain
 * JS `null` — needed anywhere a nullable Json? field can receive an explicit `null`
 * from client input (Zod's `.nullish()` allows it through as plain `null`). */
export function jsonOrDbNull<T>(value: T | null | undefined): T | typeof Prisma.DbNull | undefined {
  return value === null ? Prisma.DbNull : value;
}
