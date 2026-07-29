import { NextFunction, Request, Response } from "express";

import { decodeAccessToken } from "../core/security";
import { prisma } from "../core/prisma";

// Ports backend/app/core/deps.py's Depends() chain as Express middleware.

type UserWithRoles = Awaited<ReturnType<typeof loadUserWithRoles>>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: NonNullable<UserWithRoles>;
    }
  }
}

function loadUserWithRoles(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { permissions: true } } },
  });
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

function hasRole(user: NonNullable<UserWithRoles>, roleName: string): boolean {
  if (user.isSuperuser) return true;
  return user.roles.some((role) => role.name === roleName);
}

function hasPermission(user: NonNullable<UserWithRoles>, permissionName: string): boolean {
  if (user.isSuperuser) return true;
  return user.roles.some((role) => role.permissions.some((p) => p.name === permissionName));
}

/** Ports get_current_user + get_current_active_user (chained, since nearly every
 * protected route in the Python app depends on the "active" variant). */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ detail: "Could not validate credentials" });
    return;
  }
  const payload = decodeAccessToken(token);
  if (!payload) {
    res.status(401).json({ detail: "Could not validate credentials" });
    return;
  }
  const user = await loadUserWithRoles(payload.sub);
  if (!user) {
    res.status(401).json({ detail: "Could not validate credentials" });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ detail: "Inactive user" });
    return;
  }
  req.user = user;
  next();
}

/** Ports get_optional_user — decodes if present, never raises, just leaves req.user unset. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (token) {
    const payload = decodeAccessToken(token);
    if (payload) {
      const user = await loadUserWithRoles(payload.sub);
      if (user) req.user = user;
    }
  }
  next();
}

export function requireRole(roleName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !hasRole(req.user, roleName)) {
      res.status(403).json({ detail: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requireAnyRole(roleNames: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roleNames.some((r) => hasRole(req.user!, r))) {
      res.status(403).json({ detail: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requirePermission(permissionName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !hasPermission(req.user, permissionName)) {
      res.status(403).json({ detail: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requireSuperuser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !req.user.isSuperuser) {
    res.status(403).json({ detail: "Insufficient permissions" });
    return;
  }
  next();
}
