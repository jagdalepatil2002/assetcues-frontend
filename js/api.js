/**
 * Assetcues POC — Backend API client.
 * Dynamic URL: stored in localStorage, configurable via Settings modal.
 * Auto-fallback: tries localhost:8000, then prompts user.
 *
 * 🔍 FULL LOGGING: Every step is logged to the browser console so you
 *    can see exactly what's happening in real-time.
 */

const Api = {
  _getBaseUrl() {
    return Storage.getSettings().apiUrl || 'http://localhost:8000';
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

  async checkHealth() {
    const url = `${this._getBaseUrl()}/health`;
    this._log('HEALTH', `Checking backend → ${url}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        this._err('HEALTH', `Backend returned HTTP ${res.status}`);
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      this._log('HEALTH', '✅ Backend is healthy');
      this._log('HEALTH', `   Models → Primary: ${data.models?.primary || '?'}, Verification: ${data.models?.verification || '?'}`);
      return { ok: true, data };
    } catch(e) {
      this._err('HEALTH', `❌ Backend unreachable: ${e.message}`);
      return { ok: false, error: e.message };
    }
  },

  async extractInvoice(file, onProgress) {
    const settings = Storage.getSettings();
    const url = `${this._getBaseUrl()}/api/v1/extract/upload`;

    this._log('UPLOAD', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this._log('UPLOAD', `📄 File: ${file.name} (${(file.size / 1024).toFixed(1)} KB, ${file.type})`);
    this._log('UPLOAD', `🔗 Endpoint: ${url}`);
    this._log('UPLOAD', `🏢 Tenant: ${settings.tenantId || 'poc'}`);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('tenant_id', settings.tenantId || 'poc');
    formData.append('mode', 'creation');

    if (onProgress) onProgress('uploading', 10);
    this._log('UPLOAD', '⬆️  Uploading file to AI pipeline...');
    const startTime = performance.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
        // No timeout — extraction can take 30-120s
      });

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      this._log('AI', `⏱️  Response received in ${elapsed}s (HTTP ${res.status})`);

      if (onProgress) onProgress('processing', 70);

      if (!res.ok) {
        const body = await res.text();
        this._err('AI', `❌ Backend error (HTTP ${res.status}):`);
        this._err('AI', body);

        // Try to parse for model-specific errors
        try {
          const errJson = JSON.parse(body);
          if (errJson.detail) {
            this._err('AI', `   Detail: ${typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail)}`);
          }
          if (errJson.model_error) {
            this._err('AI', `   🤖 Model Error: ${errJson.model_error}`);
          }
        } catch {}

        throw new Error(`Extraction failed (HTTP ${res.status}): ${body.substring(0, 200)}`);
      }

      const data = await res.json();
      if (onProgress) onProgress('complete', 100);

      // Log extraction results
      this._log('AI', '✅ Extraction successful!');
      this._log('AI', `   📊 Confidence: ${(data.total_confidence * 100 || 0).toFixed(1)}%`);
      this._log('AI', `   📦 Extractions: ${data.extractions?.length || 1}`);
      if (data.model_used) this._log('AI', `   🤖 Model used: ${data.model_used}`);
      if (data.processing_time_ms) this._log('AI', `   ⏱️  AI time: ${(data.processing_time_ms / 1000).toFixed(1)}s`);

      // Log vendor/invoice info
      const json = data.extractions?.[0]?.extraction_json || data;
      const vendor = json?.vendor_details?.vendor_name?.value || json?.vendor_details?.vendor_name || '?';
      const invNo = json?.invoice_header?.invoice_number?.value || json?.invoice_header?.invoice_number || '?';
      const invDate = json?.invoice_header?.invoice_date?.value || json?.invoice_header?.invoice_date || '?';
      const total = json?.totals?.grand_total?.value ?? json?.totals?.grand_total ?? '?';
      const items = json?.line_items?.length || json?.assets_to_create?.length || 0;

      this._log('AI', `   🏪 Vendor: ${vendor}`);
      this._log('AI', `   🧾 Invoice: #${invNo} (${invDate})`);
      this._log('AI', `   💰 Total: ₹${Number(total).toLocaleString('en-IN')}`);
      this._log('AI', `   📋 Line items / Assets: ${items}`);
      this._log('AI', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return { ok: true, data };
    } catch(e) {
      this._err('UPLOAD', `❌ Request failed: ${e.message}`);

      // Detect common issues
      if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
        this._err('UPLOAD', '💡 Hint: Backend server might not be running. Start it with:');
        this._err('UPLOAD', '   cd far-ai-brain && .venv\\Scripts\\python.exe -m uvicorn far_ai_brain.api.main:app --host 0.0.0.0 --port 8000 --reload');
      }
      if (e.message.includes('quota') || e.message.includes('429')) {
        this._err('AI', '💡 Hint: API rate limit or quota exceeded. Check your GOOGLE_API_KEY usage.');
      }
      if (e.message.includes('model') || e.message.includes('gemini')) {
        this._err('AI', '💡 Hint: Model error — check .env file for correct GOOGLE_API_KEY and model names.');
      }

      return { ok: false, error: e.message };
    }
  },

  /* Auto-detect backend on page load */
  async autoDetect() {
    this._log('DETECT', 'Scanning for backend server...');
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
          this._log('DETECT', `✅ Backend found at ${testUrl}`);
          return true;
        }
      } catch {}
    }
    this._warn('DETECT', '⚠️  No backend found. Upload will fail until backend is started.');
    return false;
  },
};

window.Api = Api;
