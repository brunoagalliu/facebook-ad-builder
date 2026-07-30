import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody } from "../middleware/validate";
import { PromptCreateInput, PromptUpdateInput, promptCreateSchema, promptUpdateSchema } from "../schemas/prompt";
import { jsonOrDbNull } from "../utils/prismaJson";

// No auth on this router, matching the Python source (prompts.py has zero auth deps).
const router = Router();

router.get(
  "",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.prompt.findMany());
  })
);

router.get(
  "/:promptId",
  asyncHandler(async (req, res) => {
    const prompt = await prisma.prompt.findUnique({ where: { id: req.params.promptId } });
    if (!prompt) {
      res.status(404).json({ detail: "Prompt not found" });
      return;
    }
    res.json(prompt);
  })
);

router.post(
  "",
  validateBody(promptCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as PromptCreateInput;
    const existing = await prisma.prompt.findUnique({ where: { id: body.id } });
    if (existing) {
      res.status(400).json({ detail: "Prompt with this ID already exists" });
      return;
    }
    const prompt = await prisma.prompt.create({ data: { ...body, variables: jsonOrDbNull(body.variables) } });
    res.json(prompt);
  })
);

router.put(
  "/:promptId",
  validateBody(promptUpdateSchema),
  asyncHandler(async (req, res) => {
    const { variables, ...rest } = req.body as PromptUpdateInput;
    const existing = await prisma.prompt.findUnique({ where: { id: req.params.promptId } });
    if (!existing) {
      res.status(404).json({ detail: "Prompt not found" });
      return;
    }
    const prompt = await prisma.prompt.update({
      where: { id: req.params.promptId },
      data: { ...rest, ...(variables !== undefined ? { variables: jsonOrDbNull(variables) } : {}) },
    });
    res.json(prompt);
  })
);

router.delete(
  "/:promptId",
  asyncHandler(async (req, res) => {
    const existing = await prisma.prompt.findUnique({ where: { id: req.params.promptId } });
    if (!existing) {
      res.status(404).json({ detail: "Prompt not found" });
      return;
    }
    await prisma.prompt.delete({ where: { id: req.params.promptId } });
    res.json({ message: "Prompt deleted successfully" });
  })
);

export default router;
