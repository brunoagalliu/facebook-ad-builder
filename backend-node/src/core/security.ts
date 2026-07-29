import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";

import { settings } from "./config";

// Ports backend/app/core/security.py.

const BCRYPT_COST = 12; // matches passlib's bcrypt default rounds

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

interface AccessTokenPayload {
  sub: string;
  type: "access";
}

export function createAccessToken(userId: string): string {
  const payload: AccessTokenPayload = { sub: userId, type: "access" };
  return jwt.sign(payload, settings.SECRET_KEY, {
    algorithm: settings.ALGORITHM,
    expiresIn: `${settings.ACCESS_TOKEN_EXPIRE_MINUTES}m`,
  });
}

export function decodeAccessToken(token: string): AccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, settings.SECRET_KEY, {
      algorithms: [settings.ALGORITHM],
    }) as jwt.JwtPayload;
    if (payload.type !== "access" || typeof payload.sub !== "string") {
      return null;
    }
    return { sub: payload.sub, type: "access" };
  } catch {
    return null;
  }
}

export function createRefreshToken(): { token: string; expiresAt: Date } {
  // Opaque random token (not a JWT) — validity is purely "does a matching, unexpired
  // row exist in refresh_tokens", matching the Python implementation exactly.
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000);
  return { token, expiresAt };
}
