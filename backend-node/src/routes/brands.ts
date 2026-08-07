import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth, requirePermission } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { BrandCreateInput, brandCreateSchema, brandUpdateSchema } from "../schemas/brand";

const router = Router();

function serializeProduct(p: {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  productShots: unknown;
  defaultUrl: string | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    brand_id: p.brandId,
    name: p.name,
    description: p.description,
    product_shots: p.productShots ?? [],
    default_url: p.defaultUrl,
    created_at: p.createdAt,
  };
}

function serializeBrand(brand: {
  id: string;
  name: string;
  logo: string | null;
  voice: string | null;
  primaryColor: string;
  secondaryColor: string;
  highlightColor: string;
  verticalId: string | null;
  createdAt: Date;
  updatedAt: Date;
  products: Parameters<typeof serializeProduct>[0][];
  profiles: { id: string }[];
}) {
  return {
    id: brand.id,
    name: brand.name,
    logo: brand.logo,
    voice: brand.voice,
    colors: { primary: brand.primaryColor, secondary: brand.secondaryColor, highlight: brand.highlightColor },
    verticalId: brand.verticalId,
    created_at: brand.createdAt,
    updated_at: brand.updatedAt,
    products: brand.products.map(serializeProduct),
    profileIds: brand.profiles.map((p) => p.id),
  };
}

const brandInclude = { products: true, profiles: { select: { id: true } } } as const;

router.get(
  "",
  requireAuth,
  asyncHandler(async (req, res) => {
    const skip = Number(req.query.skip ?? 0);
    const limit = Number(req.query.limit ?? 100);
    const brands = await prisma.brand.findMany({ skip, take: limit, include: brandInclude });
    res.json(brands.map(serializeBrand));
  })
);

router.post(
  "",
  requirePermission("brands:write"),
  validateBody(brandCreateSchema),
  asyncHandler(async (req, res) => {
    const brand = req.body as BrandCreateInput;

    const created = await prisma.$transaction(async (tx) => {
      const dbBrand = await tx.brand.create({
        data: {
          ...(brand.id ? { id: brand.id } : {}),
          name: brand.name,
          logo: brand.logo,
          voice: brand.voice,
          primaryColor: brand.colors.primary,
          secondaryColor: brand.colors.secondary,
          highlightColor: brand.colors.highlight,
          verticalId: brand.verticalId,
        },
      });

      for (const p of brand.products) {
        await tx.product.create({
          data: {
            ...(p.id ? { id: p.id } : {}),
            brandId: dbBrand.id,
            name: p.name,
            description: p.description,
            productShots: p.product_shots,
          },
        });
      }

      if (brand.profileIds.length > 0) {
        await tx.brand.update({
          where: { id: dbBrand.id },
          data: { profiles: { connect: brand.profileIds.map((id) => ({ id })) } },
        });
      }

      return tx.brand.findUniqueOrThrow({ where: { id: dbBrand.id }, include: brandInclude });
    });

    res.json(serializeBrand(created));
  })
);

router.put(
  "/:brandId",
  requirePermission("brands:write"),
  validateBody(brandUpdateSchema),
  asyncHandler(async (req, res) => {
    const { brandId } = req.params;
    const brand = req.body as BrandCreateInput;

    const existingBrand = await prisma.brand.findUnique({ where: { id: brandId }, include: { products: true } });
    if (!existingBrand) {
      res.status(404).json({ detail: "Brand not found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.brand.update({
        where: { id: brandId },
        data: {
          name: brand.name,
          logo: brand.logo,
          voice: brand.voice,
          primaryColor: brand.colors.primary,
          secondaryColor: brand.colors.secondary,
          highlightColor: brand.colors.highlight,
          verticalId: brand.verticalId,
        },
      });

      const existingProducts = new Map(existingBrand.products.map((p) => [p.id, p]));
      const incomingIds = new Set<string>();

      for (const p of brand.products) {
        if (p.id && existingProducts.has(p.id)) {
          incomingIds.add(p.id);
          await tx.product.update({
            where: { id: p.id },
            data: { name: p.name, description: p.description, productShots: p.product_shots },
          });
        } else if (p.id) {
          // Product exists elsewhere (or not at all) — reassign it to this brand, or create it.
          incomingIds.add(p.id);
          const other = await tx.product.findUnique({ where: { id: p.id } });
          if (other) {
            await tx.product.update({
              where: { id: p.id },
              data: { brandId, name: p.name, description: p.description, productShots: p.product_shots },
            });
          } else {
            await tx.product.create({
              data: { id: p.id, brandId, name: p.name, description: p.description, productShots: p.product_shots },
            });
          }
        } else {
          const created = await tx.product.create({
            data: { brandId, name: p.name, description: p.description, productShots: p.product_shots },
          });
          incomingIds.add(created.id);
        }
      }

      // Products that were on this brand before but aren't in the incoming list get deleted
      // (matches the Python app's behavior — not just unassigned).
      const toDelete = existingBrand.products.filter((p) => !incomingIds.has(p.id));
      if (toDelete.length > 0) {
        await tx.product.deleteMany({ where: { id: { in: toDelete.map((p) => p.id) } } });
      }

      await tx.brand.update({
        where: { id: brandId },
        data: { profiles: { set: brand.profileIds.map((id) => ({ id })) } },
      });
    });

    const updated = await prisma.brand.findUniqueOrThrow({ where: { id: brandId }, include: brandInclude });
    res.json(serializeBrand(updated));
  })
);

router.delete(
  "/:brandId",
  requirePermission("brands:delete"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.brand.findUnique({ where: { id: req.params.brandId } });
    if (!existing) {
      res.status(404).json({ detail: "Brand not found" });
      return;
    }
    await prisma.brand.delete({ where: { id: req.params.brandId } });
    res.json({ success: true });
  })
);

export default router;
