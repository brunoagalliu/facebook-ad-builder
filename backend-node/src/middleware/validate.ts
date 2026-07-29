import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";

// Ports FastAPI/Pydantic's automatic request-body validation for routes that used a
// BaseModel schema. Replaces req.body with the parsed (and defaulted) value on success.
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(422).json({ detail: result.error.issues });
      return;
    }
    req.body = result.data;
    next();
  };
}
