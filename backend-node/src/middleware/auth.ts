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

/** Shared authentication step: decodes the bearer token, loads the user with roles+
 * permissions, checks is_active, and attaches it to req.user. Sends the appropriate
 * error response itself and returns null on failure — every exported middleware below
 * runs this first, so none of them depend on another middleware having run earlier
 * (mirrors how Python's `require_permission(...)` factory is `Depends(get_current_active_user)`
 * internally, rather than assuming a separate dependency already ran). */
async function authenticate(req: Request, res: Response): Promise<NonNullable<UserWithRoles> | null> {
  if (req.user) return req.user;

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ detail: "Could not validate credentials" });
    return null;
  }
  const payload = decodeAccessToken(token);
  if (!payload) {
    res.status(401).json({ detail: "Could not validate credentials" });
    return null;
  }
  const user = await loadUserWithRoles(payload.sub);
  if (!user) {
    res.status(401).json({ detail: "Could not validate credentials" });
    return null;
  }
  if (!user.isActive) {
    res.status(403).json({ detail: "Inactive user" });
    return null;
  }
  req.user = user;
  return user;
}

/** Ports get_current_user + get_current_active_user (chained, since nearly every
 * protected route in the Python app depends on the "active" variant). */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (await authenticate(req, res)) next();
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
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = await authenticate(req, res);
    if (!user) return;
    if (!hasRole(user, roleName)) {
      res.status(403).json({ detail: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requireAnyRole(roleNames: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = await authenticate(req, res);
    if (!user) return;
    if (!roleNames.some((r) => hasRole(user, r))) {
      res.status(403).json({ detail: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requirePermission(permissionName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = await authenticate(req, res);
    if (!user) return;
    if (!hasPermission(user, permissionName)) {
      res.status(403).json({ detail: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export async function requireSuperuser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await authenticate(req, res);
  if (!user) return;
  if (!user.isSuperuser) {
    res.status(403).json({ detail: "Insufficient permissions" });
    return;
  }
  next();
}
