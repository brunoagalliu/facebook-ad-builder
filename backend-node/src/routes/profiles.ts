import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth, requirePermission } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { ProfileBaseInput, ProfileCreateInput, profileBaseSchema, profileCreateSchema } from "../schemas/profile";

const router = Router();

// Manual snake_case (DB) <-> camelCase (API) mapping, matching the Python route exactly
// rather than relying on any ORM-level aliasing.
function serialize(p: {
  id: string;
  name: string;
  demographics: string | null;
  painPoints: string | null;
  goals: string | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    name: p.name,
    demographics: p.demographics ?? "",
    painPoints: p.painPoints ?? "",
    goals: p.goals ?? "",
    created_at: p.createdAt,
  };
}

router.get(
  "",
  requireAuth,
  asyncHandler(async (req, res) => {
    const skip = Number(req.query.skip ?? 0);
    const limit = Number(req.query.limit ?? 100);
    const profiles = await prisma.customerProfile.findMany({ skip, take: limit });
    res.json(profiles.map(serialize));
  })
);

// Permission names deliberately match the Python route's ("brands:write"/"brands:delete"
// rather than a dedicated "profiles:*" permission) — preserved as-is for parity.
router.post(
  "",
  requirePermission("brands:write"),
  validateBody(profileCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as ProfileCreateInput;
    const profile = await prisma.customerProfile.create({
      data: {
        ...(body.id ? { id: body.id } : {}),
        name: body.name,
        demographics: body.demographics,
        painPoints: body.painPoints,
        goals: body.goals,
      },
    });
    res.json(serialize(profile));
  })
);

router.put(
  "/:profileId",
  requirePermission("brands:write"),
  validateBody(profileBaseSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as ProfileBaseInput;
    const existing = await prisma.customerProfile.findUnique({ where: { id: req.params.profileId } });
    if (!existing) {
      res.status(404).json({ detail: "Profile not found" });
      return;
    }
    await prisma.customerProfile.update({
      where: { id: req.params.profileId },
      data: { name: body.name, demographics: body.demographics, painPoints: body.painPoints, goals: body.goals },
    });
    res.json({ success: true });
  })
);

router.delete(
  "/:profileId",
  requirePermission("brands:delete"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.customerProfile.findUnique({ where: { id: req.params.profileId } });
    if (!existing) {
      res.status(404).json({ detail: "Profile not found" });
      return;
    }
    await prisma.customerProfile.delete({ where: { id: req.params.profileId } });
    res.json({ success: true });
  })
);

export default router;
