# Assetcues POC Frontend

> **This is a Proof of Concept.** Not production-ready. Built for demo purposes only.
> Completely separate from the core `far-ai-brain` backend.

## Quick Start

```bash
# 1. Start the backend (in a separate terminal)
cd ../far-ai-brain
uvicorn far_ai_brain.api.main:app --reload --port 8000

# 2. Start the frontend
cd ../poc-frontend
.\serve.ps1
# or: python -m http.server 5174 --bind 127.0.0.1

# 3. Open http://127.0.0.1:5174
```

## Pages

| Page | URL | Description |
|------|-----|-------------|
| Dashboard | `/index.html` | KPIs, recent ingestions, AI status |
| Smart Upload | `/upload.html` | Drag & drop, multi-page, AI extraction |
| Review List | `/review.html` | All extractions with status filter |
| Review Detail | `/review-detail.html?id=xxx` | Side-by-side invoice + extracted data |
| Asset Registry | `/registry.html` | Searchable/filterable asset table |
| Asset Detail | `/asset-detail.html?id=xxx` | Full asset card, specs, audit trail |

## Architecture

```
poc-frontend/        ← DELETE THIS FOLDER TO REMOVE
├── index.html       ← Dashboard
├── upload.html      ← Smart Upload
├── review.html      ← Review List
├── review-detail.html ← Review Detail (approve/reject)
├── registry.html    ← Asset Registry
├── asset-detail.html ← Asset Detail + Audit Log
├── js/
│   ├── storage.js   ← localStorage CRUD layer
│   ├── api.js       ← Backend API client (dynamic URL)
│   └── app.js       ← Shared nav, settings, utilities
├── serve.ps1        ← PowerShell serve script
└── README.md        ← This file
```

## How Data Works

- **Extractions, assets, audit trails** → stored in browser `localStorage`
- **Invoice images** → stored in `localStorage` as base64 (for preview)
- **Only API call** → `POST /api/v1/extract/upload` to the `far-ai-brain` backend
- Data persists across page refreshes but is browser-specific

## Settings

Click the ⚙ icon in the sidebar or top bar to configure:
- **Backend API URL** (default: `http://localhost:8000`)
- **Tenant ID** (default: `poc`)

The app auto-detects the backend on common ports (8000, 8080, 8001, 3001).

## Removal

**To completely remove this POC:**

```bash
# 1. Delete the POC frontend folder
rm -rf poc-frontend/

# 2. (Optional) Remove POC CORS from backend
# In far-ai-brain/far_ai_brain/api/main.py, delete the block between:
#   # ── POC CORS — remove this block when shipping production frontend ──
#   ... (CORSMiddleware code)
#   # ── END POC CORS ──
```

**Impact on backend: ZERO.** The backend has no knowledge of this frontend.

## Design Source

UI designs from Stitch project: **Assetcues Invoice Agentic AI**
- Fonts: Manrope (headings) + Inter (body)
- Colors: Material Design 3 palette
- Icons: Material Symbols Outlined
- Framework: TailwindCSS (CDN)
