import { Router } from "express";

import { perMinuteLimiter } from "../core/rateLimit";
import { prisma } from "../core/prisma";
import { createAccessToken, createRefreshToken, hashPassword, verifyPassword } from "../core/security";
import { requireAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { loginJsonSchema, refreshSchema, registerSchema, updateMeSchema } from "../schemas/auth";

const router = Router();

function serializeUser(user: {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  isSuperuser: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    is_active: user.isActive,
    is_superuser: user.isSuperuser,
    created_at: user.createdAt,
  };
}

// Only an already-authenticated admin/superuser can create new users — there is no
// public self-serve signup route, matching the Python app. On a fresh DB, the first
// user comes from `prisma/seed.ts`'s ADMIN_EMAIL/ADMIN_PASSWORD bootstrap instead.
router.post("/register", perMinuteLimiter(3), requireAuth, validateBody(registerSchema), async (req, res) => {
  const currentUser = req.user!;
  const isAdmin = currentUser.isSuperuser || currentUser.roles.some((r) => r.name === "admin");
  if (!isAdmin) {
    res.status(403).json({ detail: "Insufficient permissions" });
    return;
  }

  const { email, password, name } = req.body as typeof registerSchema._type;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(400).json({ detail: "Email already registered" });
    return;
  }

  const viewerRole = await prisma.role.findUnique({ where: { name: "viewer" } });
  const user = await prisma.user.create({
    data: {
      email,
      hashedPassword: await hashPassword(password),
      name,
      roles: viewerRole ? { connect: [{ id: viewerRole.id }] } : undefined,
    },
  });
  res.status(201).json(serializeUser(user));
});

async function loginHandler(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.hashedPassword))) {
    return { error: 401 as const, detail: "Incorrect email or password" };
  }
  if (!user.isActive) {
    return { error: 403 as const, detail: "Inactive user" };
  }
  const accessToken = createAccessToken(user.id);
  const { token: refreshToken, expiresAt } = createRefreshToken();
  await prisma.refreshToken.create({ data: { userId: user.id, token: refreshToken, expiresAt } });
  return {
    error: null,
    body: { access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" },
  };
}

// OAuth2-password-flow shaped form login (matches FastAPI's OAuth2PasswordRequestForm:
// the form field is literally named `username` but matched against User.email).
router.post("/login", perMinuteLimiter(5), async (req, res) => {
  const email = req.body?.username as string | undefined;
  const password = req.body?.password as string | undefined;
  if (!email || !password) {
    res.status(422).json({ detail: "username and password are required" });
    return;
  }
  const result = await loginHandler(email, password);
  if (result.error) {
    res.status(result.error).json({ detail: result.detail });
    return;
  }
  res.json(result.body);
});

router.post("/login/json", perMinuteLimiter(5), validateBody(loginJsonSchema), async (req, res) => {
  const { email, password } = req.body as typeof loginJsonSchema._type;
  const result = await loginHandler(email, password);
  if (result.error) {
    res.status(result.error).json({ detail: result.detail });
    return;
  }
  res.json(result.body);
});

// Single-use rotating refresh tokens: the old token row is deleted and a new
// access+refresh pair issued on every call — a reused/stolen old token stops working
// the moment it's rotated once.
router.post("/refresh", perMinuteLimiter(10), validateBody(refreshSchema), async (req, res) => {
  const { refresh_token } = req.body as typeof refreshSchema._type;
  const existing = await prisma.refreshToken.findUnique({ where: { token: refresh_token } });
  if (!existing) {
    res.status(401).json({ detail: "Invalid refresh token" });
    return;
  }
  if (existing.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { id: existing.id } });
    res.status(401).json({ detail: "Refresh token expired" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: existing.userId } });
  if (!user || !user.isActive) {
    res.status(403).json({ detail: "Inactive user" });
    return;
  }

  await prisma.refreshToken.delete({ where: { id: existing.id } });
  const accessToken = createAccessToken(user.id);
  const { token: newRefreshToken, expiresAt } = createRefreshToken();
  await prisma.refreshToken.create({ data: { userId: user.id, token: newRefreshToken, expiresAt } });

  res.json({ access_token: accessToken, refresh_token: newRefreshToken, token_type: "bearer" });
});

router.post("/logout", requireAuth, validateBody(refreshSchema), async (req, res) => {
  const { refresh_token } = req.body as typeof refreshSchema._type;
  await prisma.refreshToken.deleteMany({
    where: { token: refresh_token, userId: req.user!.id },
  });
  res.json({ success: true });
});

router.get("/me", requireAuth, async (req, res) => {
  res.json(serializeUser(req.user!));
});

router.put("/me", requireAuth, validateBody(updateMeSchema), async (req, res) => {
  const { name, email, password } = req.body as typeof updateMeSchema._type;
  const currentUser = req.user!;

  if (email && email !== currentUser.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(400).json({ detail: "Email already registered" });
      return;
    }
  }

  const updated = await prisma.user.update({
    where: { id: currentUser.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(password !== undefined ? { hashedPassword: await hashPassword(password) } : {}),
    },
  });
  res.json(serializeUser(updated));
});

export default router;
