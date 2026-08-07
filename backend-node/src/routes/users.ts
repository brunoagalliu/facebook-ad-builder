import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireSuperuser } from "../middleware/auth";
import { hashPassword } from "../core/security";
import { validateBody } from "../middleware/validate";
import {
  PermissionCreateInput,
  RoleCreateInput,
  UserRoleUpdateInput,
  UserUpdateInput,
  permissionCreateSchema,
  permissionIdsSchema,
  roleCreateSchema,
  userRoleUpdateSchema,
  userUpdateSchema,
} from "../schemas/users";

const router = Router();

// Ports backend/app/api/v1/users.py. All routes are superuser-only.

function serializeRole(role: { id: string; name: string; description: string | null }) {
  return { id: role.id, name: role.name, description: role.description };
}

function serializePermission(permission: { id: string; name: string; description: string | null }) {
  return { id: permission.id, name: permission.name, description: permission.description };
}

function serializeUser(user: {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  isSuperuser: boolean;
  createdAt: Date;
  updatedAt: Date;
  roles: { id: string; name: string; description: string | null }[];
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    is_active: user.isActive,
    is_superuser: user.isSuperuser,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    roles: user.roles.map(serializeRole),
  };
}

const userWithRoles = { include: { roles: true } } as const;

router.use(requireSuperuser);

// Role management endpoints (registered before "/:userId" so "/roles" isn't
// swallowed by the dynamic param route).
router.get(
  "/roles",
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany();
    res.json(roles.map(serializeRole));
  })
);

router.post(
  "/roles",
  validateBody(roleCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as RoleCreateInput;
    const existing = await prisma.role.findUnique({ where: { name: body.name } });
    if (existing) {
      res.status(400).json({ detail: "Role already exists" });
      return;
    }
    const role = await prisma.role.create({ data: { name: body.name, description: body.description ?? null } });
    res.status(201).json(serializeRole(role));
  })
);

router.delete(
  "/roles/:roleId",
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({ where: { id: req.params.roleId } });
    if (!role) {
      res.status(404).json({ detail: "Role not found" });
      return;
    }
    await prisma.role.delete({ where: { id: req.params.roleId } });
    res.json({ message: "Role deleted successfully" });
  })
);

router.put(
  "/roles/:roleId/permissions",
  validateBody(permissionIdsSchema),
  asyncHandler(async (req, res) => {
    const permissionIds = req.body as string[];
    const role = await prisma.role.findUnique({ where: { id: req.params.roleId } });
    if (!role) {
      res.status(404).json({ detail: "Role not found" });
      return;
    }
    const permissions = await prisma.permission.findMany({ where: { id: { in: permissionIds } } });
    if (permissions.length !== permissionIds.length) {
      res.status(400).json({ detail: "One or more permission IDs are invalid" });
      return;
    }
    await prisma.role.update({
      where: { id: req.params.roleId },
      data: { permissions: { set: permissionIds.map((id) => ({ id })) } },
    });
    res.json({ message: "Role permissions updated successfully" });
  })
);

// Permission management endpoints
router.get(
  "/permissions",
  asyncHandler(async (_req, res) => {
    const permissions = await prisma.permission.findMany();
    res.json(permissions.map(serializePermission));
  })
);

router.post(
  "/permissions",
  validateBody(permissionCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as PermissionCreateInput;
    const existing = await prisma.permission.findUnique({ where: { name: body.name } });
    if (existing) {
      res.status(400).json({ detail: "Permission already exists" });
      return;
    }
    const permission = await prisma.permission.create({
      data: { name: body.name, description: body.description ?? null },
    });
    res.status(201).json(serializePermission(permission));
  })
);

// User management endpoints
router.get(
  "",
  asyncHandler(async (req, res) => {
    const skip = Number(req.query.skip ?? 0);
    const limit = Number(req.query.limit ?? 100);
    const users = await prisma.user.findMany({ ...userWithRoles, skip, take: limit });
    res.json(users.map(serializeUser));
  })
);

router.get(
  "/:userId",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId }, ...userWithRoles });
    if (!user) {
      res.status(404).json({ detail: "User not found" });
      return;
    }
    res.json(serializeUser(user));
  })
);

router.put(
  "/:userId",
  validateBody(userUpdateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as UserUpdateInput;
    const existing = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!existing) {
      res.status(404).json({ detail: "User not found" });
      return;
    }

    if (body.email !== undefined && body.email !== existing.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email: body.email } });
      if (emailTaken) {
        res.status(400).json({ detail: "Email already registered" });
        return;
      }
    }

    const user = await prisma.user.update({
      where: { id: req.params.userId },
      data: {
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.password !== undefined ? { hashedPassword: await hashPassword(body.password) } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
      },
      ...userWithRoles,
    });
    res.json(serializeUser(user));
  })
);

router.delete(
  "/:userId",
  asyncHandler(async (req, res) => {
    if (req.params.userId === req.user!.id) {
      res.status(400).json({ detail: "Cannot delete yourself" });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!existing) {
      res.status(404).json({ detail: "User not found" });
      return;
    }
    await prisma.user.delete({ where: { id: req.params.userId } });
    res.json({ message: "User deleted successfully" });
  })
);

router.put(
  "/:userId/roles",
  validateBody(userRoleUpdateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as UserRoleUpdateInput;
    const existing = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!existing) {
      res.status(404).json({ detail: "User not found" });
      return;
    }
    const roles = await prisma.role.findMany({ where: { id: { in: body.role_ids } } });
    if (roles.length !== body.role_ids.length) {
      res.status(400).json({ detail: "One or more role IDs are invalid" });
      return;
    }
    const user = await prisma.user.update({
      where: { id: req.params.userId },
      data: { roles: { set: body.role_ids.map((id) => ({ id })) } },
      ...userWithRoles,
    });
    res.json(serializeUser(user));
  })
);

export default router;
