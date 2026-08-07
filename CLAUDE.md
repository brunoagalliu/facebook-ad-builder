# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Startup Checks

On load, verify required tools are installed:

```bash
# Check agent-browser (required for e2e testing)
command -v agent-browser >/dev/null || echo "WARNING: agent-browser not installed. Run: npm install -g agent-browser && agent-browser install"
```

## Project Overview

Facebook Ad Automation App - A full-stack application for automating the lifecycle of Facebook video and image ads, from competitor research to ad creation, launching, and performance reporting.

**Tech Stack:**
- Frontend: React 19 + Vite + TailwindCSS
- Backend: Node.js + TypeScript (Express, Prisma)
- Database: PostgreSQL on Railway
- Storage: Cloudflare R2 (S3-compatible)
- Testing: agent-browser (e2e), Vitest (unit)
- Hosting: Railway (backend + frontend + database)

## Development Commands

### Backend

```bash
cd backend-node

# Install dependencies
npm install

# Apply migrations + seed roles/permissions (and bootstrap superuser if
# ADMIN_EMAIL/ADMIN_PASSWORD are set)
npx prisma migrate deploy
npx tsx prisma/seed.ts

# Run development server (tsx watch)
npm run dev  # Runs on http://localhost:8000

# Build + run production build
npm run build
npm start

# Lint / format
npm run lint
npm run format

# Run tests
npm test
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev  # Runs on http://localhost:5173

# Build for production
npm run build

# Lint code
npm run lint

# Preview production build
npm run preview
```

### Full Stack Development

The backend API runs on `http://localhost:8000` and the frontend on `http://localhost:5173`.

## Architecture

### Database Models (backend-node/prisma/schema.prisma)

Core entities and their relationships:

- **Brand**: Central entity with logo, colors (primary/secondary/highlight), voice
  - Has many Products (cascade delete)
  - Has many CustomerProfiles (many-to-many via a join table)
  - Has many GeneratedAds

- **Product**: Belongs to Brand, contains description, product_shots (JSON), default_url

- **CustomerProfile**: Demographics, pain_points, goals - linked to Brands

- **WinningAd**: Template library with structural analysis, blueprint_json for Ad Remix Engine

- **GeneratedAd**: Output from AI generation, links Brand + Product + Template, includes ad_bundle_id for grouping

- **FacebookCampaign/AdSet/Ad**: Hierarchy for Facebook campaign management with fb_*_id fields for syncing

- **ScrapedAd**: Competitor ads from research module

- **User/Role/Permission/RefreshToken**: JWT auth with role-based access control

### Backend Structure (Express + Prisma)

```
backend-node/src/
├── index.ts              # Entry point: DB connectivity check, listen, cron start
├── app.ts                # Express app wiring: CORS, security headers, router registration
├── core/
│   ├── config.ts          # Settings, validates DATABASE_URL is PostgreSQL
│   ├── prisma.ts          # Prisma client (driver adapter)
│   ├── security.ts        # Password hashing, JWT access/refresh tokens
│   ├── rateLimit.ts
│   └── cron.ts             # Scheduled search cron
├── middleware/
│   ├── auth.ts             # requireAuth/requireRole/requirePermission/requireSuperuser
│   ├── validate.ts         # Zod request-body validation
│   └── asyncHandler.ts
├── routes/                # API endpoints (all mounted under /api/v1)
│   ├── auth.ts
│   ├── users.ts            # User/role/permission management (superuser only)
│   ├── brands.ts
│   ├── products.ts
│   ├── profiles.ts         # Customer profiles
│   ├── generatedAds.ts     # AI-generated ads
│   ├── facebook.ts         # Campaign/AdSet/Ad management
│   ├── research.ts         # Competitor scraping
│   ├── adRemix.ts          # Blueprint deconstruction/reconstruction
│   ├── copyGeneration.ts
│   ├── templates.ts
│   ├── uploads.ts
│   └── dashboard.ts
├── services/               # Business logic
│   ├── facebookService.ts   # Facebook Marketing API (facebook-nodejs-business-sdk)
│   ├── researchService.ts
│   ├── scraperService.ts
│   └── adRemixService.ts    # Uses Gemini Vision for template analysis
├── schemas/                 # Zod request/response schemas
└── prisma/
    ├── schema.prisma
    ├── migrations/
    └── seed.ts               # Seeds roles/permissions + optional bootstrap superuser
```

**Key Backend Patterns:**
- All routes use `/api/v1` prefix
- Auth via Express middleware (`requireAuth`, `requirePermission(...)`, `requireSuperuser`), not per-route DI
- PostgreSQL required - core/config.ts validates DATABASE_URL on startup
- Facebook API uses `facebook-nodejs-business-sdk` (AdAccount, Campaign, AdSet, Ad, AdCreative, AdImage)
- AI services use Google Gemini (GEMINI_API_KEY), Anthropic (ANTHROPIC_API_KEY) and Fal.ai (FAL_AI_API_KEY)
- File uploads go to Cloudflare R2 when configured, falls back to local `uploads/` for dev

### Frontend Structure (React + Vite)

```
frontend/src/
├── App.jsx              # Router setup, wraps with ToastProvider/BrandProvider/CampaignProvider
├── main.jsx             # Entry point
├── components/          # Reusable UI components
│   ├── Layout.jsx       # Main layout with navigation
│   ├── Toast.jsx        # Toast notification component
│   ├── Wizard.jsx       # Multi-step wizard
│   ├── BrandForm.jsx
│   ├── ProductForm.jsx
│   ├── CustomerProfileForm.jsx
│   └── ...wizard steps and builders
├── pages/               # Route components
│   ├── Dashboard.jsx
│   ├── Research.jsx     # Competitor analysis
│   ├── CreateAds.jsx    # Ad creation flow
│   ├── ImageAds.jsx
│   ├── VideoAds.jsx
│   ├── AdRemix.jsx      # Template remix engine
│   ├── GeneratedAds.jsx # View generated ads
│   ├── Brands.jsx
│   ├── Products.jsx
│   ├── CustomerProfiles.jsx
│   ├── FacebookCampaigns.jsx
│   ├── WinningAds.jsx   # Template library
│   └── Reporting.jsx
├── context/             # React Context for global state
│   ├── ToastContext.jsx     # useToast() hook
│   ├── BrandContext.jsx
│   └── CampaignContext.jsx
└── lib/                 # Utilities
    ├── supabase.js
    └── facebookApi.js
```

**Key Frontend Patterns:**
- API calls to backend at `http://localhost:8000/api/v1`
- All routes wrapped in Layout component for consistent navigation
- Toast notifications managed via ToastContext

## Critical UI/UX Rules (from specifications.md)

### Toast Notifications (MANDATORY)

**NEVER use browser `alert()`.** Always use the `useToast` hook:

```javascript
import { useToast } from '../context/ToastContext';

const { showSuccess, showError, showWarning, showInfo } = useToast();

showSuccess('Operation completed successfully');
showError('Failed to save. Please try again.');
showWarning('This action cannot be undone');
showInfo('Processing your request...');
```

- Duration defaults to 5 seconds (customizable via second parameter)
- Types: `success` (green), `error` (red), `warning` (amber), `info` (blue)

### Confirmation Modals (MANDATORY)

**NEVER use browser `confirm()`.** Create custom modal components:

```javascript
const [showDeleteModal, setShowDeleteModal] = useState(false);

const handleDelete = () => setShowDeleteModal(true);

const confirmDelete = async () => {
    setShowDeleteModal(false);
    // Perform delete action
    showSuccess('Deleted successfully');
};
```

Modal design requirements:
- Backdrop blur with semi-transparent overlay
- Clear title and description
- Destructive actions use red buttons
- Non-destructive actions use gray/neutral buttons
- Icon to indicate action type (trash, warning, etc.)

## Database Requirements

**PostgreSQL is REQUIRED.** SQLite is deprecated and will cause startup errors.

Production uses Railway PostgreSQL. Local dev connects to the same Railway database for shared data.

### Local Development

Uses Railway PostgreSQL (configured in `.env.local`). No local database setup needed.

### Environment Variables

Create `.env.local` in project root:

```bash
# Database (Railway PostgreSQL)
DATABASE_URL=postgresql://postgres:xxx@host.proxy.rlwy.net:port/railway

# Cloudflare R2 Storage
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=your-bucket
R2_PUBLIC_URL=https://pub-xxx.r2.dev

# AI Services
GEMINI_API_KEY=...
FAL_AI_API_KEY=...
KIE_AI_API_KEY=...

# Facebook Marketing API
VITE_FACEBOOK_ACCESS_TOKEN=...
VITE_FACEBOOK_API_VERSION=v24.0

# Auth
SECRET_KEY=...  # Generate with: openssl rand -base64 32
```

**Railway Environment Variables** (set in dashboard):
- `DATABASE_URL` → Use `${{Postgres.DATABASE_URL}}` to auto-sync with Postgres service
- `SECRET_KEY` → Strong random key for JWT auth
- All R2_* variables for storage
- All AI API keys

## Search & Refactoring Tools

- Use `ast-grep` for structural code search/replace (AST-aware, not text):
  - `ast-grep -p 'const API_URL = $VAL' --lang js` - find API_URL declarations
  - `ast-grep -p 'useState($INIT)' --lang tsx` - find useState patterns
  - `ast-grep -p '$OLD($$$)' -r '$NEW($$$)' --lang js` - rename functions
  - Useful for bulk refactors across React/JS codebase

## Code Style & Standards

### Backend (TypeScript/Node)
- **Formatter**: Prettier
- **Linter**: ESLint
- **Naming**: `camelCase` for functions/variables, `PascalCase` for classes/types

### Frontend (JavaScript/React)
- **Formatter**: Prettier
- **Linter**: ESLint (react, react-hooks plugins)
- **Naming**:
  - Components: `PascalCase.jsx`
  - Functions/Variables: `camelCase`
  - Constants: `UPPER_SNAKE_CASE`

## Security Notes

- CORS restricted to specific origins (configure via ALLOWED_ORIGINS env var)
- JWT-based authentication implemented (access + refresh tokens)
- File uploads limited to images (jpg, jpeg, png, gif, webp), 10MB max
- All secrets stored in environment variables (never committed)
- CSP configured in frontend to restrict resource loading

## Key Features

1. **Brand Management**: Create brands with voice, colors, logos
2. **Product Catalog**: Manage products with descriptions and images
3. **Customer Profiles**: Define target audience demographics
4. **Research Module**: Scrape competitor ads from Facebook Ad Library
5. **Ad Generation**: AI-powered ad creation using Gemini + Fal.ai
6. **Ad Remix Engine**: Deconstruct winning ads into blueprints, reconstruct with new brands
7. **Facebook Campaign Management**: Create/manage campaigns, ad sets, and ads via API
8. **Generated Ads Gallery**: View ads grouped by bundle_id
9. **Reporting**: Analytics dashboard (in development)

## Deployment

**Railway Setup:**
1. Backend auto-deploys from `main` branch via Dockerfile
2. Frontend auto-deploys from `main` branch via Nixpacks
3. Database is Railway PostgreSQL service
4. Custom domain → CNAME to Railway

**Post-Deploy Verification:**
```bash
railway logs --tail 30  # Look for "Facebook Ad Automation API listening on port 8080"
```

**MANDATORY - Feature Testing After Deployment:**
For ANY new feature deployment, run ALL applicable tests:

1. **Smoke Tests** (agent-browser):
```bash
cd frontend
BASE_URL=https://your-app.com npm run test:smoke

# Or run individual tests:
BASE_URL=https://your-app.com npm run test:login
TEST_EMAIL=user@example.com TEST_PASSWORD=xxx npm run test:auth
```

2. **Unit Tests** (backend):
```bash
cd backend-node
npm test
```

3. **Unit Tests** (frontend):
```bash
cd frontend
npm run test:unit
```

**Test file locations:**
- Frontend e2e: `frontend/tests/agent-browser/*.sh`
- Frontend unit: `frontend/src/**/*.test.js`
- Backend unit: `backend-node/src/**/*.test.ts` (Jest; no suite exists yet — `npm test` passes with none)

**agent-browser Quick Reference:**
```bash
agent-browser open <url>          # Open URL
agent-browser snapshot            # Get accessibility tree
agent-browser click '<selector>'  # Click element
agent-browser fill '<sel>' 'val'  # Fill input
agent-browser screenshot /tmp/x.png
agent-browser close               # Close browser
```

**Cloudflare R2 Setup:**
- Bucket: configured via R2_BUCKET_NAME
- Public access enabled via R2.dev URL
- CORS configured to allow frontend origins

## Common Gotchas

- Database migrations run automatically on deploy via the Dockerfile CMD (`npx prisma migrate deploy`)
- Always commit ALL new Prisma migration files and their dependencies before pushing
- Frontend API URL set via `VITE_API_URL` env var (build-time, not runtime)
- When adding new origins: update CORS in `backend-node/src/app.ts` AND CSP in `index.html`
- Ad account IDs auto-prefixed with 'act_' if missing (facebookService.ts)
- Local dev uses same Railway DB + R2 as production (shared data) — note `backend-node/.env` currently points at a separate local staging Postgres DB for that service's own dev workflow; check which `DATABASE_URL` is active before assuming shared-data behavior
