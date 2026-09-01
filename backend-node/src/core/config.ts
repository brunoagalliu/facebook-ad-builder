import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }
  return value;
}

const DATABASE_URL = required("DATABASE_URL");
if (!DATABASE_URL.startsWith("postgresql://") && !DATABASE_URL.startsWith("postgres://")) {
  throw new Error(
    `DATABASE_URL must be a PostgreSQL connection string. Got: ${DATABASE_URL.split(":")[0]}://...`
  );
}

const SECRET_KEY = process.env.SECRET_KEY ?? "";
if (!SECRET_KEY || SECRET_KEY === "your-secret-key-change-in-production") {
  throw new Error(
    "SECRET_KEY environment variable is required for security.\n" +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"'
  );
}

export const settings = {
  PROJECT_NAME: "Facebook Ad Automation App",
  API_V1_STR: "/api/v1",

  DATABASE_URL,
  SECRET_KEY,
  ALGORITHM: "HS256" as const,
  ACCESS_TOKEN_EXPIRE_MINUTES: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES ?? "30"),
  REFRESH_TOKEN_EXPIRE_DAYS: Number(process.env.REFRESH_TOKEN_EXPIRE_DAYS ?? "7"),

  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  FAL_AI_API_KEY: process.env.FAL_AI_API_KEY ?? "",
  // Fal.ai splits keys into "API" scope (generation, model discovery — what
  // FAL_AI_API_KEY normally is) and "Admin" scope (account/billing endpoints).
  // A regular API-scope key 403s on the billing balance check, so that lookup needs
  // its own separate, more-sensitive admin key rather than reusing the generation one.
  FAL_AI_ADMIN_KEY: process.env.FAL_AI_ADMIN_KEY ?? "",
  KIE_AI_API_KEY: process.env.KIE_AI_API_KEY ?? "",

  FACEBOOK_ACCESS_TOKEN: process.env.FACEBOOK_ACCESS_TOKEN ?? process.env.VITE_FACEBOOK_ACCESS_TOKEN ?? "",
  FACEBOOK_AD_ACCOUNT_ID: process.env.FACEBOOK_AD_ACCOUNT_ID ?? process.env.VITE_FACEBOOK_AD_ACCOUNT_ID ?? "",
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID ?? "",
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET ?? "",
  FACEBOOK_ADS_LIBRARY_TOKEN: process.env.FACEBOOK_ADS_LIBRARY_TOKEN ?? "",

  ADPLEXITY_API_KEY: process.env.ADPLEXITY_API_KEY ?? "",

  FB_SCRAPER_EMAIL: process.env.FB_SCRAPER_EMAIL ?? "",
  FB_SCRAPER_PASSWORD: process.env.FB_SCRAPER_PASSWORD ?? "",

  CRON_SECRET: process.env.CRON_SECRET ?? "",

  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ?? "",
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "",
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "",
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ?? "",
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL ?? "",

  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? "",
  TRUSTED_PROXIES: process.env.TRUSTED_PROXIES ?? "*",

  // Railway sets this to the service's own public domain automatically — used so
  // locally-stored uploads (Railway Volume, not R2) can return an absolute URL
  // instead of a bare "/uploads/..." path. A relative path only works if the
  // consumer happens to be on the same origin, which the deployed frontend isn't.
  PUBLIC_BASE_URL: process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${process.env.PORT ?? 8000}`,

  get r2Enabled(): boolean {
    return Boolean(this.R2_ACCOUNT_ID && this.R2_ACCESS_KEY_ID && this.R2_SECRET_ACCESS_KEY);
  },
  get r2EndpointUrl(): string {
    return `https://${this.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  },
};
