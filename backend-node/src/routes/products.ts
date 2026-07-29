import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth, requirePermission } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { ProductCreateInput, ProductUpdateInput, productCreateSchema, productUpdateSchema } from "../schemas/product";

const router = Router();

function serialize(p: {
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

router.get(
  "",
  requireAuth,
  asyncHandler(async (req, res) => {
    const skip = Number(req.query.skip ?? 0);
    const limit = Number(req.query.limit ?? 100);
    const products = await prisma.product.findMany({ skip, take: limit });
    res.json(products.map(serialize));
  })
);

router.get(
  "/:productId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({ where: { id: req.params.productId } });
    if (!product) {
      res.status(404).json({ detail: "Product not found" });
      return;
    }
    res.json(serialize(product));
  })
);

router.post(
  "",
  requirePermission("products:write"),
  validateBody(productCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as ProductCreateInput;
    const product = await prisma.product.create({
      data: {
        ...(body.id ? { id: body.id } : {}),
        brandId: body.brand_id,
        name: body.name,
        description: body.description,
        productShots: body.product_shots,
        defaultUrl: body.default_url,
      },
    });
    res.json(serialize(product));
  })
);

router.put(
  "/:productId",
  requirePermission("products:write"),
  validateBody(productUpdateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as ProductUpdateInput;
    const existing = await prisma.product.findUnique({ where: { id: req.params.productId } });
    if (!existing) {
      res.status(404).json({ detail: "Product not found" });
      return;
    }
    const updated = await prisma.product.update({
      where: { id: req.params.productId },
      data: {
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.product_shots !== undefined ? { productShots: body.product_shots } : {}),
        ...(body.default_url !== undefined ? { defaultUrl: body.default_url } : {}),
      },
    });
    res.json(serialize(updated));
  })
);

router.delete(
  "/:productId",
  requirePermission("products:delete"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findUnique({ where: { id: req.params.productId } });
    if (!existing) {
      res.status(404).json({ detail: "Product not found" });
      return;
    }
    await prisma.product.delete({ where: { id: req.params.productId } });
    res.json({ message: "Product deleted successfully" });
  })
);

export default router;
