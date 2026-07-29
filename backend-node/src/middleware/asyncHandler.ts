import { NextFunction, Request, Response } from "express";

// Express 4 doesn't forward rejected promises from async handlers to error middleware
// on its own — wrap every async route so an unexpected throw becomes a handled 500
// (matching FastAPI's default behavior for an uncaught exception) instead of hanging.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
