<p align="center">
  <img src="frontend/public/breadwinner_logo.png" alt="BreadWinner" width="120" />
</p>

<h1 align="center">BreadWinner</h1>

<p align="center">
  <strong>AI-powered Facebook ad automation platform</strong><br>
  Competitor research, AI blueprint learning, and multi-model ad generation — all the way to a live campaign
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#deployment">Deployment</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-18+-green.svg" alt="Node 18+">
  <img src="https://img.shields.io/badge/react-19-61dafb.svg" alt="React 19">
  <img src="https://img.shields.io/badge/express-4-000000.svg" alt="Express">
  <img src="https://img.shields.io/badge/postgresql-15+-336791.svg" alt="PostgreSQL">
</p>

---

## Overview

BreadWinner takes a Facebook ad from "what's working for competitors" to "live in Ads Manager," with AI doing the heavy lifting at every stage in between. Scrape real competitor ads (either by keyword search against Meta's Ad Library API, or by pointing at a specific competitor's Facebook Page and letting a headless browser pull their whole archive), have Gemini deconstruct what's structurally winning about them into a reusable blueprint, then generate new on-brand ad copy, images, and video from those blueprints — choosing a single reference ad or a synthesized pattern learned across an entire niche. Push the result straight into a Facebook campaign, or export it.

### Key Capabilities

- **Competitor Intelligence** — keyword search against Meta's official Ad Library API, or full-archive scraping of a specific competitor page via Playwright
- **AI Blueprint Learning** — Gemini vision/video analysis turns a winning ad into a structural blueprint (layout, narrative arc, hooks, pacing, psychological triggers), auto-tagged with a detected niche/vertical
- **Multi-Model Ad Generation** — image generation (Nano Banana Pro / Google Imagen) and video generation (Seedance 2.0 continuous-take, or Kling O3 real multi-shot storyboarding), each steerable from one specific winning ad or a synthesis across a whole vertical's proven patterns
- **Real Reference Images** — capture a live screenshot of a product's actual landing page/signup form so generated ads can show it, not an AI-imagined guess
- **Brand & Product Management** — brand voice, colors, verticals, and a product catalog with per-product creative assets
- **Facebook Campaign Management** — create and manage campaigns, ad sets, and ads directly via the Marketing API

---

## Features

### 🔍 Competitor Research
Two complementary paths: keyword search against Meta's Ad Library API (fast, precise, works within a saved search + vertical), and full-archive Brand Scraping for a specific competitor's Facebook Page (Playwright-driven, since Meta's page-based search API is unreliable for retrieving a page's complete ad history). Scraped ads carry real media, copy, and platform data.

### 🧠 AI Blueprint Engine (Ad Remix)
Promote any scraped ad — or a manually uploaded one — into a **Winning Ad** template. Gemini vision analyzes image ads for layout, narrative arc, text hierarchy, and psychological triggers; Gemini's video understanding does the same for video ads (hook type, pacing, cinematography, authenticity signals), plus auto-detects and tags the ad's niche/vertical so it's immediately reusable for any brand in that space.

### 🎨 Image & Video Generation
Generate new ads informed by what's already proven to work:
- **Image ads** — Nano Banana Pro or Google Imagen, with a choice of a hand-picked style, one specific winning ad, or a meta-blueprint synthesized across an entire vertical's pool of winners
- **Video ads** — Seedance 2.0 for a single continuous UGC-style take, or Kling O3 for real multi-shot storyboarding (up to 6 distinct cuts in one generation), with the same single-ad/whole-vertical choice
- **Real reference images** — product photos, or a live Playwright screenshot of the product's actual signup form, feed generation as reference material instead of relying on the model's imagination

### 🏷️ Brand & Product Management
- Brand voice, messaging guidelines, and color palette
- Verticals for organizing brands and blueprints by niche
- Product catalog with images, description, and a landing-page URL (screenshottable as a reference asset)
- Customer profiles for audience targeting context

### 📊 Facebook Campaign Management
Create and manage campaigns, ad sets, and ads directly through the Marketing API, upload creative assets, and track sync status against Facebook Ads Manager.

### 🗂️ Generated Ads Gallery
Every generated ad is grouped by bundle, browsable and exportable to CSV, with headline/body/CTA and media all in one place.

---

## Quick Start

### Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org))
- **PostgreSQL** 15+ (local, or cloud: [Railway](https://railway.app), [Supabase](https://supabase.com))

### Option 1: Interactive Setup

```bash
git clone <your-fork-url>
cd facebook_ad_builder
./setup.sh
```

The wizard checks prerequisites, walks through API key configuration, sets up the database, and creates your admin account.

### Option 2: Manual Setup

<details>
<summary>Click to expand manual setup instructions</summary>

#### 1. Clone and Install

```bash
git clone <your-fork-url>
cd facebook_ad_builder

cd backend-node && npm install
cd ../frontend && npm install
```

#### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials — see [Environment Variables](#environment-variables).

#### 3. Initialize Database

```bash
cd backend-node
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

#### 4. Start the Application

```bash
# Terminal 1
cd backend-node && npm run dev

# Terminal 2
cd frontend && npm run dev
```

</details>

### Access the Application

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |

---

## External Services

### Required

| Service | Purpose | Setup |
|---------|---------|-------|
| **PostgreSQL** | Database | Local install, [Railway](https://railway.app), or [Supabase](https://supabase.com) |
| **Google Gemini** | Ad copy, blueprint analysis, image/video understanding | [Get API Key](https://aistudio.google.com/app/apikey) |

### Optional

| Service | Purpose | Setup |
|---------|---------|-------|
| **Facebook Marketing API** | Campaign management, Ad Library research | [Developer Portal](https://developers.facebook.com) |
| **Kie.ai** | Image generation (Nano Banana Pro) and video generation (Seedance 2.0, Kling O3) | [kie.ai](https://kie.ai) |
| **Fal.ai** | Image generation fallback | [fal.ai](https://fal.ai) |
| **Cloudflare R2** | Media storage; falls back to local disk if unset | [Cloudflare Dashboard](https://dash.cloudflare.com) |

### Facebook Developer Setup

<details>
<summary>Click to expand</summary>

1. Go to [developers.facebook.com](https://developers.facebook.com), create an app (Business type), add the Marketing API product.
2. Graph API Explorer → generate a User Access Token with `ads_management`, `ads_read`, `business_management`.
3. Find your Ad Account ID in [Ads Manager](https://adsmanager.facebook.com) → Settings.

```bash
FACEBOOK_ACCESS_TOKEN=your-token
FACEBOOK_AD_ACCOUNT_ID=act_123456789
FACEBOOK_APP_ID=your-app-id
FACEBOOK_APP_SECRET=your-app-secret
```

> Access tokens expire after ~60 days. Ad Library research uses a separate token from campaign publishing — see the app's Dashboard for expiry warnings.

</details>

### Cloudflare R2 Setup

<details>
<summary>Click to expand</summary>

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → R2 → create a bucket.
2. R2 → Manage API Tokens → create a token with read/write on the bucket.
3. Bucket Settings → Public Access → enable the R2.dev subdomain.

```bash
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=facebook-ads
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

If unset, uploads fall back to local disk automatically.

</details>

---

## Environment Variables

Create `.env.local` in the project root:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SECRET_KEY` | ✅ | JWT signing key |
| `GEMINI_API_KEY` | ✅ | Google Gemini — ad copy, blueprint analysis, vision/video understanding |
| `ALLOWED_ORIGINS` | Production | Comma-separated CORS origins |
| `FACEBOOK_ACCESS_TOKEN` | For campaign publishing | Facebook Marketing API token |
| `FACEBOOK_ADS_LIBRARY_TOKEN` | For research | Separate token for Ad Library search |
| `FACEBOOK_AD_ACCOUNT_ID` | For FB features | Facebook Ad Account ID |
| `KIE_AI_API_KEY` | For image/video generation | Nano Banana Pro, Seedance, Kling O3 |
| `FAL_AI_API_KEY` | Image gen fallback | Fal.ai API key |
| `R2_*` | For persistent storage | Cloudflare R2 credentials |

See `.env.example` for the full list.

---

## Architecture

```
facebook_ad_builder/
├── backend-node/               # Node.js + TypeScript (Express, Prisma)
│   ├── src/
│   │   ├── routes/            # REST endpoints (/api/v1/*)
│   │   ├── services/          # Business logic
│   │   │   ├── researchService.ts        # Ad Library keyword search
│   │   │   ├── brandScraperService.ts    # Playwright brand/page scraping
│   │   │   ├── winnerPromotionService.ts # Scraped ad -> Winning Ad blueprint
│   │   │   ├── adRemixService.ts         # Image blueprint deconstruction/reconstruction
│   │   │   ├── videoBlueprintService.ts  # Video blueprint deconstruction
│   │   │   ├── blueprintSelectionService.ts   # Per-brand blueprint auto-pick
│   │   │   ├── blueprintSynthesisService.ts   # Whole-vertical blueprint synthesis
│   │   │   ├── imageGenerationService.ts # Nano Banana Pro / Imagen / Fal.ai
│   │   │   ├── videoGenerationService.ts # Seedance 2.0 / Kling O3
│   │   │   ├── screenshotService.ts      # Landing-page reference screenshots
│   │   │   └── facebookService.ts        # Marketing API
│   │   ├── app.ts             # Express app wiring
│   │   └── index.ts           # Entry point
│   ├── prisma/                # Schema, migrations, seed
│   └── package.json
├── frontend/                   # React + Vite
│   ├── src/
│   │   ├── pages/             # Route components (Research, ImageAds, VideoAds, ...)
│   │   ├── components/        # Reusable UI
│   │   ├── context/           # React context (Brand, Toast, Auth, Campaign)
│   │   └── lib/                # Utilities
│   └── package.json
└── .env.example
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, TailwindCSS |
| Backend | Node.js, TypeScript, Express, Prisma |
| Database | PostgreSQL |
| Scraping | Playwright |
| AI text/vision/video | Google Gemini |
| AI image/video generation | Kie.ai (Nano Banana Pro, Seedance 2.0, Kling O3), Fal.ai |
| Storage | Cloudflare R2 (local disk fallback) |
| Auth | JWT (access + refresh tokens) |
| Hosting | Railway |

---

## Testing

```bash
# Frontend unit tests
cd frontend && npm run test:unit

# Frontend E2E (agent-browser)
npm run test:smoke
TEST_EMAIL=user@example.com TEST_PASSWORD=xxx npm run test:auth

# Backend
cd backend-node && npm test
```

---

## Deployment

### Railway (Recommended)

1. Push this repo to your own GitHub account.
2. [Create a new Railway project](https://railway.app/new) → Deploy from GitHub repo.
3. Add a PostgreSQL database: **+ New** → **Database** → **PostgreSQL**.
4. Set environment variables on both the backend and frontend services.
5. Set `ALLOWED_ORIGINS` to your frontend's deployed URL.

Migrations run automatically on deploy via the backend's Dockerfile `CMD`.

📖 **[Full Deployment Guide →](./RAILWAY_DEPLOYMENT.md)**

### Docker

```bash
cd backend-node
docker build -t fb-ad-backend .
docker run -p 8000:8000 --env-file ../.env.local fb-ad-backend

cd frontend
docker build -t fb-ad-frontend .
docker run -p 5173:5173 fb-ad-frontend
```

---

## Troubleshooting

<details>
<summary><strong>DATABASE_URL environment variable is required</strong></summary>

- Ensure `.env.local` exists in the project root.
- Verify the format: `postgresql://user:pass@host:5432/dbname`.
- Check PostgreSQL is running: `pg_isready`.

</details>

<details>
<summary><strong>CORS errors in browser</strong></summary>

- Add your frontend URL to `ALLOWED_ORIGINS` in `.env.local`, restart the backend.

</details>

<details>
<summary><strong>Facebook API errors</strong></summary>

- Access tokens expire after ~60 days — check the Dashboard for expiry warnings.
- Ad Library research and campaign publishing use separate tokens; confirm you're using the right one.
- Verify Ad Account ID format: `act_123456789`.

</details>

<details>
<summary><strong>AI generation not working</strong></summary>

- Verify `GEMINI_API_KEY` is set and has quota at [Google AI Studio](https://aistudio.google.com).
- For image/video generation, confirm `KIE_AI_API_KEY` (or `FAL_AI_API_KEY` as fallback) is set and has credits.

</details>

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request
