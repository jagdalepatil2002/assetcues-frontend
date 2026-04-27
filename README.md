# AssetCues POC Frontend

This is the frontend interface for the AssetCues Smart Upload and Extraction dashboard. It interfaces directly with the hosted `VLM-OCR-MODEL` backend on Azure App Service, mapping AI extractions into the Supabase remote database.

## Backend API

The frontend talks to the hosted backend by default — no local Python server required.

- **Base URL:** `https://assetcues-far-are0e2c4fmaedhc3.centralindia-01.azurewebsites.net`
- **Health check:** `GET /health`
- **Standard extraction (multipart upload):** `POST /extract/upload`
- **Precise extraction:** `POST /extract/precise/upload`
- **Asset image identification:** `POST /identify/upload`

The base URL is configurable from the in-app **Settings** modal (saved to `localStorage` under `ac_settings`). Any legacy `localhost` / `127.0.0.1` value is automatically migrated to the Azure URL on next load.

## Prerequisites
- Node.js (for the local frontend static server)

## How to Start the Frontend

Only the frontend server is required — the backend is already hosted on Azure.

```powershell
# Navigate to the frontend directory
cd poc-frontend

# Start the local web server
node server.js
```
*Alternatively, you can just run `.\serve.ps1` in PowerShell.*

Then open [http://127.0.0.1:5174](http://127.0.0.1:5174) in your browser.

## (Optional) Running the Backend Locally
If you need to run the VLM-OCR backend on your own machine for development, point the **Settings → Backend API URL** to `http://127.0.0.1:8000` after starting it:
```powershell
cd "..\VLM-OCR-MODEL-V1.4  quick extraction"
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Features Added
- **Multi-File Batch Extraction:** Upload up to 8 invoices at a time; the frontend handles queueing them sequentially to the backend.
- **Asset Image Upload:** Create single assets on the fly by uploading photos (nameplates, barcodes).
- **Interactive Review UI:** Review, approve, and sync LLM/OCR generated structured data back into your master inventory.
