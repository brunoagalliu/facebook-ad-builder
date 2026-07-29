/**
 * Ports backend/init_db.py's seed logic: default roles/permissions, and an optional
 * bootstrap superuser from ADMIN_EMAIL/ADMIN_PASSWORD. There is no public self-registration
 * route (POST /auth/register requires an already-authenticated admin), so on a fresh
 * database this seed is the only way to get a first user in — run it once per environment.
 * Idempotent: safe to re-run.
 */
import "dotenv/config";

import { prisma } from "../src/core/prisma";
import { hashPassword } from "../src/core/security";

const ROLES = ["admin", "manager", "editor", "viewer"] as const;

// "resource:action" convention, matching the permission names already referenced by
// the existing Python routes (brands:write/delete, campaigns:write, ads:write/delete,
// templates:write) plus the same shape for resources ported later in this rewrite.
const PERMISSIONS = [
  "brands:write",
  "brands:delete",
  "products:write",
  "products:delete",
  "templates:write",
  "templates:delete",
  "campaigns:write",
  "ads:write",
  "ads:delete",
] as const;

const ROLE_PERMISSIONS: Record<(typeof ROLES)[number], readonly string[]> = {
  admin: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => !p.endsWith(":delete")),
  editor: ["brands:write", "products:write", "templates:write", "ads:write"],
  viewer: [],
};

async function main(): Promise<void> {
  const roleRows = new Map<string, { id: string }>();
  for (const name of ROLES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    roleRows.set(name, role);
  }

  const permissionRows = new Map<string, { id: string }>();
  for (const name of PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    permissionRows.set(name, permission);
  }

  for (const roleName of ROLES) {
    const permissionNames = ROLE_PERMISSIONS[roleName];
    await prisma.role.update({
      where: { name: roleName },
      data: {
        permissions: {
          set: permissionNames.map((name) => ({ id: permissionRows.get(name)!.id })),
        },
      },
    });
  }
  console.log(`Seeded ${ROLES.length} roles and ${PERMISSIONS.length} permissions.`);

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email: adminEmail,
          hashedPassword: await hashPassword(adminPassword),
          isSuperuser: true,
          roles: { connect: [{ id: roleRows.get("admin")!.id }] },
        },
      });
      console.log(`Created bootstrap superuser: ${adminEmail}`);
    } else {
      console.log(`Superuser ${adminEmail} already exists, skipping.`);
    }
  } else {
    console.log("ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping bootstrap superuser creation.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
