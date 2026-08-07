# Facebook Ad Automation App - Architecture Specifications

## 1. Overview
This document serves as the Source of Truth for the Facebook Ad Automation App. The application is designed to automate the lifecycle of Facebook video ads, from competitor research to ad creation, launching, and performance reporting.

## 2. Tech Stack

### Frontend
- **Framework**: React (Vite)
- **Language**: JavaScript (ES6+) / TypeScript (Recommended)
- **Styling**: TailwindCSS (Utility-first)
- **State Management**: 
    - Server State: React Query (TanStack Query)
    - Local State: React Context API or Zustand
- **HTTP Client**: Axios or Fetch API (via centralized `api/` client)
- **Notifications**: Toast notification system (Mandatory)

### Backend
- **Framework**: Express (Node.js)
- **Runtime**: Node.js 18+, TypeScript
- **Database**: PostgreSQL (REQUIRED)
    - **Driver**: `pg` (via Prisma's driver adapter)
    - **ORM**: Prisma
    - **Migrations**: Prisma Migrate
    - **NOTE**: SQLite is DEPRECATED and must not be used.
- **Scheduled Tasks**: `node-cron` (in-process, for long-running/periodic tasks)

### Infrastructure
- **Containerization**: Docker
- **Hosting**: Vercel (Frontend), Cloud Provider (Backend)

## 3. Security & Standards (CRITICAL)

### Authentication & Authorization
- **Auth Provider**: Custom JWT (access + refresh tokens).
- **Middleware**: All protected routes MUST be secured via `requireAuth`/`requirePermission(...)`/`requireSuperuser` Express middleware.
- **RBAC**: Implement Role-Based Access Control where necessary.
- **CORS**: Strict `allow_origins` policy (Development: `localhost:5173`, Production: Specific Domain). **Wildcard `*` is PROHIBITED in production.**

### Code Formatting & Style
**Backend (TypeScript)**
- **Formatter**: `Prettier`
- **Linter**: `ESLint`
- **Naming**: `camelCase` for functions/variables, `PascalCase` for classes/types.

**Frontend (JavaScript/React)**
- **Style Guide**: Airbnb or Standard JS
- **Formatter**: `Prettier`
- **Linter**: `ESLint` (`eslint-plugin-react`, `eslint-plugin-react-hooks`)
- **Naming**: 
    - Components: `PascalCase.jsx`
    - Functions/Variables: `camelCase`
    - Constants: `UPPER_SNAKE_CASE`

### UI/UX Patterns

**Toast Notifications**
- **Rule**: NEVER use browser `alert()`. Use the provided `useToast` hook.
- **Usage**:
    ```javascript
    const { showSuccess, showError, showWarning, showInfo } = useToast();
    showSuccess('Saved successfully');
    showError('Failed to save. Please try again.');
    ```
- **Duration**: Default 5 seconds, customizable via second parameter
- **Types**: `success` (green), `error` (red), `warning` (amber), `info` (blue)

**Confirmation Modals**
- **Rule**: NEVER use browser `confirm()`. Create custom modal components.
- **Pattern**: Use state-based modals with explicit "Cancel" and "Confirm" buttons
- **Example**:
    ```javascript
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    
    // Trigger modal
    const handleDelete = () => setShowDeleteModal(true);
    
    // Confirm action
    const confirmDelete = async () => {
        setShowDeleteModal(false);
        // Perform delete action
        showSuccess('Deleted successfully');
    };
    ```
- **Design Requirements**:
    - Backdrop blur with semi-transparent overlay
    - Clear title and description
    - Destructive actions use red buttons
    - Non-destructive actions use gray/neutral buttons
    - Icon to indicate action type (trash for delete, warning for caution, etc.)

## 4. Folder Structure & API Architecture

The project follows a modular structure. API routes are versioned (`/api/v1`).

```
/
├── backend-node/
│   ├── src/
│   │   ├── app.ts            # Express app wiring & CORS
│   │   ├── index.ts          # Entry point
│   │   ├── core/             # Config, Security, Prisma client
│   │   ├── schemas/          # Zod Schemas
│   │   ├── middleware/       # Auth, validation
│   │   ├── services/         # Business Logic (Facebook, AI, Scraper)
│   │   └── routes/           # Route Handlers
│   │       ├── brands.ts
│   │       ├── products.ts
│   │       ├── facebook.ts      # Campaign Management
│   │       ├── generatedAds.ts  # Ad Creation
│   │       ├── research.ts      # Competitor Analysis
│   │       ├── uploads.ts       # File Management
│   │       └── dashboard.ts     # Analytics
│   ├── prisma/                # Schema, migrations, seed
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/      # Reusable UI
│   │   ├── pages/           # Route Views
│   │   ├── context/         # Global State
│   │   └── lib/             # Utilities & API Clients
└── specifications.md
```

## 5. Module Specifications

### Module 1: Brand & Product Management
- **Endpoints**: `/api/v1/brands`, `/api/v1/products`
- **Features**: Manage brand voice, assets, and product details.

### Module 2: Research (Scraping)
- **Endpoints**: `/api/v1/research`
- **Features**: Analyze competitor ads from Facebook Ad Library.

### Module 3: Ad Generation (AI)
- **Endpoints**: `/api/v1/generated-ads`, `/api/v1/copy-generation`
- **Features**: 
    - Generate scripts via LLM (Gemini).
    - Create video assets via AI (Kie.ai/Fal.ai).

### Module 4: Campaign Launching (Facebook)
- **Endpoints**: `/api/v1/facebook`
- **Features**: 
    - Manage Ad Accounts, Campaigns, Ad Sets, Ads.
    - Upload Creatives.
    - **Requirement**: Use `facebook-nodejs-business-sdk`.

### Module 5: Reporting
- **Endpoints**: `/api/v1/dashboard`
- **Features**: Visualize ROAS, CTR, CPM metrics.

### Module 6: File Uploads
- **Endpoint**: `POST /api/v1/uploads/`
- **Security**:
    - **Type Check**: Images only (jpg, png, webp).
    - **Size Limit**: 10MB.
    - **Storage**: Local `uploads/` directory (Dev) or S3 (Prod).
    - **Sanitization**: UUID-based filenames.

## 6. Environment Variables

**Backend (.env)**
```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db_name

# Security
SECRET_KEY=your_secret_key
ACCESS_TOKEN_EXPIRE_MINUTES=30

# External APIs
GEMINI_API_KEY=...
FAL_AI_API_KEY=...
FACEBOOK_ACCESS_TOKEN=...
```

**Frontend (.env)**
```bash
VITE_API_URL=http://localhost:8000
VITE_FACEBOOK_ACCESS_TOKEN=... # For client-side checks if needed
```
