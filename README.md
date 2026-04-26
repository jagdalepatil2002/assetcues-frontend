# AssetCues POC Frontend

This is the frontend interface for the AssetCues Smart Upload and Extraction dashboard. It interfaces directly with the `VLM-OCR-MODEL-V1.4` backend mapping AI extractions into the Supabase remote database.

## Prerequisites
- Node.js (for the frontend server)
- Python 3.10+ (for the VLM-OCR backend)

## How to Start the Application

You need to run **both** the backend Python server and the frontend Node.js server. Open two separate terminal windows.

### 1. Start the VLM-OCR Backend Server
Open your first terminal and run the following commands:
```powershell
# Navigate to the backend directory
cd "..\VLM-OCR-MODEL-V1.4  quick extraction"

# Install requirements (if you haven't already)
pip install -r requirements.txt

# Start the FastAPI server
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
*The backend API will run on `http://127.0.0.1:8000`*

### 2. Start the POC Frontend Server
Open your second terminal and run the following commands:
```powershell
# Navigate to the frontend directory
cd poc-frontend

# Start the local web server
node server.js
```
*Alternatively, you can just run `.\serve.ps1` in PowerShell.*

### 3. Open the App
Navigate to [http://127.0.0.1:5174](http://127.0.0.1:5174) in your browser.

## Features Added
- **Multi-File Batch Extraction:** Upload up to 8 invoices at a time; the frontend handles queueing them sequentially to the backend.
- **Asset Image Upload:** Create single assets on the fly by uploading photos (nameplates, barcodes).
- **Interactive Review UI:** Review, approve, and sync LLM/OCR generated structured data back into your master inventory.
