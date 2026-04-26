/**
 * Assetcues POC — VLM-OCR Backend API client.
 * Connects to VLM-OCR-MODEL-V1.4 FastAPI backend.
 * Dynamic URL: stored in localStorage, configurable via Settings modal.
 *
 * Endpoints:
 *   POST /extract/upload              — Standard extraction (FAR Manager AI)
 *   POST /extract/precise/upload       — Precise extraction (spreadsheet-style)
 *   POST /extract/enrich               — Invoice enrichment on existing asset
 *   POST /identify/upload              — Asset image identification
 *   POST /identify/enhance             — Asset image enhancement (with invoice)
 *   GET  /health                       — Backend health check
 *
 * 🔍 FULL LOGGING: Every step is logged to the browser console.
 */

const Api = {
  _getBaseUrl() {
    return Storage.getSettings().apiUrl || 'https://assetcues-far-are0e2c4fmaedhc3.centralindia-01.azurewebsites.net';
  },

  _getApiKey() {
    return Storage.getSettings().apiKey || '';
  },

  _log(tag, ...args) {
    const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
    console.log(`%c[${ts}] [${tag}]`, 'color:#009668;font-weight:bold', ...args);
  },

  _warn(tag, ...args) {
    const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
    console.warn(`%c[${ts}] [${tag}]`, 'color:#e6a700;font-weight:bold', ...args);
  },

  _err(tag, ...args) {
    const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
    console.error(`%c[${ts}] [${tag}]`, 'color:#ba1a1a;font-weight:bold', ...args);
  },

  /** Build common headers including optional API key */
  _buildHeaders(extra = {}) {
    const headers = { ...extra };
    const apiKey = this._getApiKey();
    if (apiKey) headers['X-API-Key'] = apiKey;
    return headers;
  },

  /* ═══════════════════════════════════════════════════════
   * HEALTH CHECK
   * ═══════════════════════════════════════════════════════ */
  async checkHealth() {
    const url = `${this._getBaseUrl()}/health`;
    this._log('HEALTH', `Checking backend → ${url}`);
    try {
      const res = await fetch(url, {
        headers: this._buildHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this._err('HEALTH', `Backend returned HTTP ${res.status}`);
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      this._log('HEALTH', '✅ Backend is healthy');
      if (data.models) this._log('HEALTH', `   Models → Primary: ${data.models.primary || '?'}, Verification: ${data.models.verification || '?'}`);
      if (data.version) this._log('HEALTH', `   Version: ${data.version}`);
      return { ok: true, data };
    } catch(e) {
      this._err('HEALTH', `❌ Backend unreachable: ${e.message}`);
      return { ok: false, error: e.message };
    }
  },

  /* ═══════════════════════════════════════════════════════
   * STANDARD EXTRACTION — /api/v1/extract/upload
   * Response: { success, data: { page_N: {...} }, assets: [...], metadata: {...} }
   * ═══════════════════════════════════════════════════════ */
  async extractInvoice(file, onProgress) {
    const url = `${this._getBaseUrl()}/extract/upload`;

    this._log('UPLOAD', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this._log('UPLOAD', `📄 File: ${file.name} (${(file.size / 1024).toFixed(1)} KB, ${file.type})`);
    this._log('UPLOAD', `🔗 Endpoint: ${url}`);

    const formData = new FormData();
    formData.append('file', file);

    if (onProgress) onProgress('uploading', 5);
    this._log('UPLOAD', '⬆️  Uploading file to VLM-OCR pipeline...');
    const startTime = performance.now();

    try {
      const { status, responseText } = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let processingTimer = null;
        let fakePct = 38;

        // Real upload progress: 5% → 35%
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            const pct = Math.max(5, Math.round((e.loaded / e.total) * 35));
            onProgress('uploading', pct);
          }
        };

        // Upload to server done → start fake AI processing ticker: 38% → 82%
        xhr.upload.onload = () => {
          if (onProgress) onProgress('processing', 38);
          processingTimer = setInterval(() => {
            fakePct = Math.min(fakePct + 1, 82);
            if (onProgress) onProgress('processing', fakePct);
          }, 2500);
        };

        xhr.onload = () => {
          if (processingTimer) clearInterval(processingTimer);
          resolve({ status: xhr.status, responseText: xhr.responseText });
        };

        xhr.onerror = () => { if (processingTimer) clearInterval(processingTimer); reject(new Error('Failed to fetch')); };
        xhr.onabort = () => { if (processingTimer) clearInterval(processingTimer); reject(new Error('Request aborted')); };

        xhr.open('POST', url);
        // Set API key header if configured
        const apiKey = this._getApiKey();
        if (apiKey) xhr.setRequestHeader('X-API-Key', apiKey);
        xhr.send(formData);
      });

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      this._log('AI', `⏱️  Response received in ${elapsed}s (HTTP ${status})`);

      if (onProgress) onProgress('processing', 90);

      if (status < 200 || status >= 300) {
        const body = responseText;
        this._err('AI', `❌ Backend error (HTTP ${status}):`);
        this._err('AI', body);

        try {
          const errJson = JSON.parse(body);
          if (errJson.detail) {
            this._err('AI', `   Detail: ${typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail)}`);
          }
        } catch {}

        throw new Error(`Extraction failed (HTTP ${status}): ${body.substring(0, 200)}`);
      }

      const data = JSON.parse(responseText);
      if (onProgress) onProgress('complete', 100);

      // Log VLM-OCR extraction results
      this._log('AI', '✅ VLM-OCR Extraction successful!');
      this._log('AI', `   📊 Success: ${data.success}`);
      const assetCount = data.assets?.length || 0;
      this._log('AI', `   📦 Generated Assets: ${assetCount}`);
      const pageCount = data.metadata?.page_count || Object.keys(data.data || {}).length || 1;
      this._log('AI', `   📄 Pages processed: ${pageCount}`);

      // Log metadata
      if (data.metadata) {
        const m = data.metadata;
        this._log('AI', `   🤖 Model: ${m.provider || '?'}/${m.model || '?'}`);
        this._log('AI', `   ⏱️  Processing: ${(m.processing_time_ms / 1000).toFixed(1)}s`);
        this._log('AI', `   🧮 Tokens: ${m.input_tokens || 0} in / ${m.output_tokens || 0} out`);
      }

      // Log first page header info
      const firstPage = data.data?.page_1 || {};
      const header = firstPage.header || {};
      this._log('AI', `   🏪 Vendor: ${header.vnd_name || header.vendor || '?'}`);
      this._log('AI', `   🧾 Invoice: #${header.inv_no || '?'} (${header.inv_dt || '?'})`);
      this._log('AI', `   💰 Total: ${firstPage.footer?.total || '?'}`);
      this._log('AI', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return { ok: true, data };
    } catch(e) {
      this._err('UPLOAD', `❌ Request failed: ${e.message}`);

      if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
        this._err('UPLOAD', '💡 Hint: VLM-OCR backend might not be running. Start it with:');
        this._err('UPLOAD', '   cd VLM-OCR-MODEL-V1.4 && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload');
      }
      if (e.message.includes('quota') || e.message.includes('429')) {
        this._err('AI', '💡 Hint: API rate limit or quota exceeded. Check your GOOGLE_API_KEY usage.');
      }

      return { ok: false, error: e.message };
    }
  },

  /* ═══════════════════════════════════════════════════════
   * PRECISE EXTRACTION — /api/v1/extract/precise/upload
   * Response: { success, data: PreciseInvoiceRow[], invoice_summary, page_analyses, invoice_groups, metadata }
   * ═══════════════════════════════════════════════════════ */
  async extractPrecise(file, onProgress) {
    const url = `${this._getBaseUrl()}/extract/precise/upload`;

    this._log('PRECISE', `📄 Precise extraction: ${file.name}`);
    const formData = new FormData();
    formData.append('file', file);

    if (onProgress) onProgress('uploading', 5);
    const startTime = performance.now();

    try {
      const { status, responseText } = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let processingTimer = null;
        let fakePct = 38;

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            const pct = Math.max(5, Math.round((e.loaded / e.total) * 35));
            onProgress('uploading', pct);
          }
        };
        xhr.upload.onload = () => {
          if (onProgress) onProgress('processing', 38);
          processingTimer = setInterval(() => { fakePct = Math.min(fakePct + 1, 82); if (onProgress) onProgress('processing', fakePct); }, 2500);
        };
        xhr.onload = () => { if (processingTimer) clearInterval(processingTimer); resolve({ status: xhr.status, responseText: xhr.responseText }); };
        xhr.onerror = () => { if (processingTimer) clearInterval(processingTimer); reject(new Error('Failed to fetch')); };
        xhr.onabort = () => { if (processingTimer) clearInterval(processingTimer); reject(new Error('Request aborted')); };

        xhr.open('POST', url);
        const apiKey = this._getApiKey();
        if (apiKey) xhr.setRequestHeader('X-API-Key', apiKey);
        xhr.send(formData);
      });

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      if (status < 200 || status >= 300) throw new Error(`Precise extraction failed (HTTP ${status}): ${responseText.substring(0, 200)}`);

      const data = JSON.parse(responseText);
      if (onProgress) onProgress('complete', 100);
      this._log('PRECISE', `✅ Precise extraction done in ${elapsed}s — ${data.data?.length || 0} rows`);
      return { ok: true, data };
    } catch(e) {
      this._err('PRECISE', `❌ ${e.message}`);
      return { ok: false, error: e.message };
    }
  },

  /* ═══════════════════════════════════════════════════════
   * ASSET IMAGE IDENTIFICATION — /api/v1/identify/upload
   * ═══════════════════════════════════════════════════════ */
  async identifyAsset(imageFile, onProgress) {
    const url = `${this._getBaseUrl()}/identify/upload`;
    this._log('IDENTIFY', `📷 Asset identification: ${imageFile.name}`);

    const formData = new FormData();
    formData.append('file', imageFile);

    if (onProgress) onProgress('uploading', 10);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Identification failed (HTTP ${res.status}): ${errText.substring(0, 200)}`);
      }

      const data = await res.json();
      if (onProgress) onProgress('complete', 100);
      this._log('IDENTIFY', `✅ Asset identified: ${data.data?.asset_name?.value || '?'}`);
      return { ok: true, data };
    } catch(e) {
      this._err('IDENTIFY', `❌ ${e.message}`);
      return { ok: false, error: e.message };
    }
  },

  /* ═══════════════════════════════════════════════════════
   * ASSET IMAGE ENHANCEMENT — /api/v1/identify/enhance
   * ═══════════════════════════════════════════════════════ */
  async enhanceAsset(imageFile, invoiceFile, onProgress) {
    const url = `${this._getBaseUrl()}/identify/enhance`;
    this._log('ENHANCE', `📷+📄 Asset enhancement`);

    const formData = new FormData();
    formData.append('asset_image', imageFile);
    if (invoiceFile) formData.append('invoice_file', invoiceFile);

    if (onProgress) onProgress('uploading', 10);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Enhancement failed (HTTP ${res.status}): ${errText.substring(0, 200)}`);
      }

      const data = await res.json();
      if (onProgress) onProgress('complete', 100);
      this._log('ENHANCE', `✅ Asset enhanced successfully`);
      return { ok: true, data };
    } catch(e) {
      this._err('ENHANCE', `❌ ${e.message}`);
      return { ok: false, error: e.message };
    }
  },

  /* ═══════════════════════════════════════════════════════
   * INVOICE ENRICHMENT — /api/v1/extract/enrich
   * ═══════════════════════════════════════════════════════ */
  async enrichInvoice(file, existingAssets, onProgress) {
    const url = `${this._getBaseUrl()}/extract/enrich`;
    this._log('ENRICH', `📄 Invoice enrichment: ${file.name}`);

    const formData = new FormData();
    formData.append('file', file);
    if (existingAssets) formData.append('existing_assets', JSON.stringify(existingAssets));

    if (onProgress) onProgress('uploading', 10);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Enrichment failed (HTTP ${res.status}): ${errText.substring(0, 200)}`);
      }

      const data = await res.json();
      if (onProgress) onProgress('complete', 100);
      this._log('ENRICH', `✅ Enrichment complete`);
      return { ok: true, data };
    } catch(e) {
      this._err('ENRICH', `❌ ${e.message}`);
      return { ok: false, error: e.message };
    }
  },

  /* ═══════════════════════════════════════════════════════
   * BATCH UPLOAD — multiple files to /api/v1/extract/upload
   * ═══════════════════════════════════════════════════════ */
  async extractBatch(files, onProgress) {
    this._log('BATCH', `📦 Batch extraction: ${files.length} file(s)`);
    const results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileProgress = (stage, pct) => {
        const overall = Math.round(((i + pct / 100) / files.length) * 100);
        if (onProgress) onProgress(stage, overall, { fileIndex: i, fileName: file.name });
      };

      this._log('BATCH', `   [${i + 1}/${files.length}] Processing ${file.name}...`);
      const result = await this.extractInvoice(file, fileProgress);
      results.push({ file: file.name, ...result });
    }

    const successCount = results.filter(r => r.ok).length;
    this._log('BATCH', `✅ Batch complete: ${successCount}/${files.length} succeeded`);
    return results;
  },

  /* ═══════════════════════════════════════════════════════
   * AUTO-DETECT BACKEND
   * ═══════════════════════════════════════════════════════ */
  async autoDetect() {
    this._log('DETECT', 'Scanning for VLM-OCR backend...');
    const health = await this.checkHealth();
    if (health.ok) {
      this._log('DETECT', `✅ Backend found at ${this._getBaseUrl()}`);
      return true;
    }

    // Only try localhost ports if current URL is already localhost-based
    const currentUrl = this._getBaseUrl();
    if (!currentUrl.includes('localhost') && !currentUrl.includes('127.0.0.1')) {
      this._warn('DETECT', 'Custom backend URL configured but unreachable. Skipping localhost scan.');
      return false;
    }

    // Try common ports
    const ports = ['8000', '8080', '8001', '3001'];
    for (const port of ports) {
      const testUrl = `http://localhost:${port}`;
      this._log('DETECT', `   Trying ${testUrl}...`);
      try {
        const res = await fetch(`${testUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const s = Storage.getSettings();
          s.apiUrl = testUrl;
          Storage.saveSettings(s);
          this._log('DETECT', `✅ VLM-OCR backend found at ${testUrl}`);
          return true;
        }
      } catch {}
    }
    this._warn('DETECT', '⚠️  No VLM-OCR backend found. Upload will fail until backend is started.');
    return false;
  },
};

window.Api = Api;
