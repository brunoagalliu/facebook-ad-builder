import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";

import { settings } from "./core/config";
import { securityHeaders } from "./middleware/securityHeaders";
import adStylesRouter from "./routes/adStyles";
import authRouter from "./routes/auth";
import brandsRouter from "./routes/brands";
import dashboardRouter from "./routes/dashboard";
import productsRouter from "./routes/products";
import profilesRouter from "./routes/profiles";
import promptsRouter from "./routes/prompts";
import templatesRouter from "./routes/templates";
import uploadsRouter from "./routes/uploads";

// Ports main.py's FastAPI app wiring: CORS, security headers, trust-proxy, static /uploads,
// and the plain "/" and "/health" routes. Feature routers (auth, brands, research, facebook,
// etc.) are mounted here as each is ported in later phases — see the plan's Phase B onward.
export function createApp(): express.Express {
  const app = express();

  // main.py: ProxyHeadersMiddleware trusts X-Forwarded-* per TRUSTED_PROXIES (default "*")
  app.set("trust proxy", settings.TRUSTED_PROXIES === "*" ? true : settings.TRUSTED_PROXIES);

  const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    ...settings.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
  ];

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      exposedHeaders: ["X-Total-Count"],
      maxAge: 600,
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(securityHeaders);

  // main.py mounts local uploads/ at /uploads via StaticFiles, creating the dir if missing
  const uploadsDir = path.join(__dirname, "..", "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  app.use("/uploads", express.static(uploadsDir));

  app.get("/", (_req: Request, res: Response) => {
    res.json({ message: "Welcome to the Facebook Ad Automation API" });
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "healthy" });
  });

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/brands", brandsRouter);
  app.use("/api/v1/products", productsRouter);
  app.use("/api/v1/profiles", profilesRouter);
  app.use("/api/v1/templates", templatesRouter);
  app.use("/api/v1/ad-styles", adStylesRouter);
  app.use("/api/v1/prompts", promptsRouter);
  app.use("/api/v1/uploads", uploadsRouter);
  app.use("/api/v1/dashboard", dashboardRouter);

  // Remaining feature routers mount here as they're ported, e.g.:
  // app.use("/api/v1/copy-generation", copyGenerationRouter);
  // ... (see backend/app/main.py for the full prefix list to mirror)

  app.use((req: Request, res: Response) => {
    res.status(404).json({ detail: "Not Found" });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ detail: "Internal server error" });
  });

  return app;
}
