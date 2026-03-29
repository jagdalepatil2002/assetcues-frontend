/**
 * AssetCues — Pure Supabase storage layer (no localStorage).
 * All data lives in Supabase. In-memory cache for performance.
 * Cross-device sync: any browser sees the same data.
 */

const ORG_ID = DEFAULT_ORG_ID;

// ── Helpers ──────────────────────────────────────
function _normalizeDate(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    let day = parseInt(m[1]), month = parseInt(m[2]);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1) return null;
    const daysInMonth = new Date(parseInt(m[3]), month, 0).getDate();
    if (day > daysInMonth) return null;
    return `${m[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

function _unwrap(v) {
  if (v && typeof v === 'object' && 'value' in v) return v.value;
  return v;
}

// ── In-Memory Cache (replaces localStorage) ──────
const _cache = {
  extractions: [],
  assets: [],
  vendors: [],
  templates: [],
  locations: [],
  departments: [],
};

const Storage = {

  // ═══════════════════════════════════════════════════
  // SETTINGS (only thing still in localStorage — API URL)
  // ═══════════════════════════════════════════════════
  getSettings() {
    try {
      const raw = localStorage.getItem('ac_settings');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { apiUrl: 'https://assetcues-backend.onrender.com', tenantId: 'poc' };
  },
  saveSettings(s) { try { localStorage.setItem('ac_settings', JSON.stringify(s)); } catch {} },

  // ═══════════════════════════════════════════════════
  // EXTRACTIONS
  // ═══════════════════════════════════════════════════
  async fetchExtractions() {
    const data = await Supabase.query('extractions', { order: 'created_at.desc', filters: { org_id: ORG_ID } });
    _cache.extractions = (data || []).map(e => this._dbToExtraction(e));
    // Populate assetIds from cached assets
    const assets = _cache.assets;
    _cache.extractions.forEach(ext => {
      ext.assetIds = assets.filter(a => a.extractionId === ext.id).map(a => a.id);
    });
    return _cache.extractions;
  },

  getExtractions() { return _cache.extractions; },
  getExtraction(id) { return _cache.extractions.find(e => e.id === id) || null; },

  async getExtractionAsync(id) {
    let ext = this.getExtraction(id);
    if (ext) return ext;
    const row = await Supabase.query('extractions', { filters: { id }, single: true });
    if (!row) return null;
    ext = this._dbToExtraction(row);
    const linkedAssets = await Supabase.query('assets', { select: 'id', filters: { extraction_id: id } });
    ext.assetIds = (linkedAssets || []).map(a => a.id);
    return ext;
  },

  async saveExtraction(data) {
    const dbData = this._extractionToDb(data);
    dbData.id = data.id;
    dbData.org_id = ORG_ID;
    await Supabase.upsert('extractions', dbData);
    // Refresh cache
    const idx = _cache.extractions.findIndex(e => e.id === data.id);
    if (idx >= 0) _cache.extractions[idx] = data;
    else _cache.extractions.unshift(data);
    return data;
  },

  async createExtraction(fileName, extractionJson, confidence, pageCount) {
    console.log('%c[STORAGE] 📥 createExtraction starting...', 'color:#005da9;font-weight:bold');

    const vendorName = (_unwrap(extractionJson?.vendor_details?.vendor_name)) || 'Unknown';
    const invoiceNumber = (_unwrap(extractionJson?.invoice_header?.invoice_number)) || '';
    const invoiceDateRaw = (_unwrap(extractionJson?.invoice_header?.invoice_date)) || null;
    const invoiceDate = _normalizeDate(invoiceDateRaw);
    const grandTotal = parseFloat(_unwrap(extractionJson?.totals?.grand_total)) || 0;

    // Check for duplicates
    const isDuplicate = await this._checkDuplicateInvoice(invoiceNumber, vendorName);

    const extraction = {
      id: crypto.randomUUID(),
      fileName, extractionJson, confidence, pageCount,
      vendorName, invoiceNumber, invoiceDate, grandTotal,
      status: 'draft',
      timestamp: new Date().toISOString(),
      assetIds: [],
    };

    // Insert extraction to DB
    await Supabase.insert('extractions', {
      id: extraction.id, org_id: ORG_ID, file_name: fileName, status: 'draft',
      confidence, extraction_json: extractionJson, vendor_name: vendorName,
      invoice_number: invoiceNumber, invoice_date: invoiceDate, grand_total: grandTotal,
      duplicate_of: isDuplicate ? 'duplicate' : null,
    });

    // Expand assets
    const assets = await this._expandAssets(extraction);
    extraction.assetIds = assets.map(a => a.id);

    // Duplicate alert
    if (isDuplicate) {
      await Supabase.insert('anomaly_alerts', {
        org_id: ORG_ID, alert_type: 'duplicate_invoice', severity: 'high',
        title: `Possible duplicate: Invoice #${invoiceNumber}`,
        description: `Invoice #${invoiceNumber} from ${vendorName} may already exist.`,
        related_extraction_id: extraction.id,
      });
    }

    _cache.extractions.unshift(extraction);
    console.log('%c[STORAGE] ✅ createExtraction complete', 'color:#005da9;font-weight:bold');
    return extraction;
  },

  async approveExtraction(id) {
    const ext = this.getExtraction(id);
    if (!ext) return;
    ext.status = 'approved';
    ext.approvedAt = new Date().toISOString();
    await this.saveExtraction(ext);

    const now = new Date().toISOString();
    const baseUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}`;

    // Query assets directly from DB
    const linkedAssets = await Supabase.query('assets', { select: 'id,asset_number,asset_id', filters: { extraction_id: id } }) || [];

    for (const row of linkedAssets) {
      const qrUrl = `${baseUrl}asset-detail.html?id=${row.id}`;
      await Supabase.update('assets', row.id, {
        status: 'verified', verification_date: now,
        barcode: String(row.asset_id || row.asset_number),
        qr_code_data: qrUrl,
      });
    }

    // Link invoice to all assets (one row per asset, same invoice)
    const invoiceNumber = ext.invoiceNumber || '';
    const invoiceDate = ext.invoiceDate || null;
    const grandTotal = ext.grandTotal || 0;
    if (invoiceNumber && linkedAssets.length > 0) {
      const invoiceRows = linkedAssets.map(row => ({
        asset_id: row.id, extraction_id: id, invoice_type: 'purchase',
        invoice_number: invoiceNumber, invoice_date: invoiceDate,
        amount: grandTotal, description: `Auto-linked from: ${ext.fileName || ''}`,
      }));
      await Supabase.insert('asset_invoices', invoiceRows);
    }

    ext.assetIds = linkedAssets.map(r => r.id);
    await this.addAuditEntry(id, null, 'approved', 'Extraction approved by user');
    await this.fetchAssets();
  },

  async rejectExtraction(id) {
    console.log('%c[STORAGE] 🚫 Rejecting extraction:', 'color:#ba1a1a;font-weight:bold', id);
    const ext = this.getExtraction(id);
    if (!ext) return;

    // Record rejection audit (null extraction_id so it survives deletion)
    await Supabase.insert('audit_trail', {
      extraction_id: null, asset_id: null, action: 'rejected',
      notes: `Extraction ${ext.fileName || ''} (Invoice #${ext.invoiceNumber || ''}, ID: ${id}) rejected. ${(ext.assetIds || []).length} assets removed.`,
      performed_by: 'user', created_at: new Date().toISOString(),
    });

    // Cascade delete via DB function
    let rpcResult = null;
    try { rpcResult = await Supabase.rpc('delete_extraction_cascade', { p_extraction_id: id }); } catch(e) {}
    if (!rpcResult) {
      // Fallback
      await Supabase.deleteWhere('asset_invoices', { extraction_id: id });
      await Supabase.deleteWhere('anomaly_alerts', { related_extraction_id: id });
      await Supabase.deleteWhere('audit_trail', { extraction_id: id });
      const linked = await Supabase.query('assets', { select: 'id', filters: { extraction_id: id } }) || [];
      for (const row of linked) {
        await Supabase.deleteWhere('asset_invoices', { asset_id: row.id });
        await Supabase.deleteWhere('audit_trail', { asset_id: row.id });
        await Supabase.deleteWhere('depreciation_entries', { asset_id: row.id });
        await Supabase.deleteWhere('physical_audits', { asset_id: row.id });
      }
      await Supabase.deleteWhere('assets', { extraction_id: id });
      await Supabase.delete('extractions', id);
    }

    // Remove from memory cache
    const idx = _cache.extractions.findIndex(e => e.id === id);
    if (idx >= 0) _cache.extractions.splice(idx, 1);
    await this.fetchAssets();
    console.log('%c[STORAGE] ✅ Rejection complete', 'color:#ba1a1a;font-weight:bold');
  },

  // ═══════════════════════════════════════════════════
  // ASSETS
  // ═══════════════════════════════════════════════════
  async fetchAssets() {
    const data = await Supabase.query('assets', { order: 'created_at.desc', filters: { org_id: ORG_ID } });
    _cache.assets = (data || []).map(a => this._dbToAsset(a));
    return _cache.assets;
  },

  getAssets() { return _cache.assets; },
  getAsset(id) { return _cache.assets.find(a => a.id === id) || null; },

  async getAssetAsync(id) {
    let asset = this.getAsset(id);
    if (asset) return asset;
    const row = await Supabase.query('assets', { filters: { id }, single: true });
    if (!row) return null;
    return this._dbToAsset(row);
  },

  async saveAsset(data) {
    const dbData = this._assetToDb(data);
    await Supabase.update('assets', data.id, dbData);
    const idx = _cache.assets.findIndex(a => a.id === data.id);
    if (idx >= 0) _cache.assets[idx] = data;
    else _cache.assets.unshift(data);
    return data;
  },

  async _getNextAssetNumber() {
    const result = await Supabase.query('assets', { select: 'asset_number', filters: { org_id: ORG_ID }, order: 'created_at.desc', limit: 50 });
    if (result && result.length > 0) {
      let maxNum = 1000;
      for (const r of result) {
        const m = (r.asset_number || '').match(/^AST-(\d+)$/);
        if (m) { const num = parseInt(m[1]); if (num > maxNum) maxNum = num; }
      }
      return maxNum + 1;
    }
    return 1001;
  },

  _parseSerialNumbers(json) {
    const serials = [];
    (json.assets_to_create || []).forEach(a => { if (a.serial_number) serials.push(a.serial_number); });
    if (serials.length > 0) return serials;
    (json.line_items || []).forEach(li => {
      if (li.serial_numbers_listed && Array.isArray(li.serial_numbers_listed))
        li.serial_numbers_listed.forEach(s => serials.push(s));
    });
    return serials;
  },

  async _expandAssets(extraction) {
    const json = extraction.extractionJson;
    if (!json) return [];

    let nextNum = await this._getNextAssetNumber();
    const serialNumbers = this._parseSerialNumbers(json);
    const vendor = (_unwrap(json.vendor_details?.vendor_name)) || 'Unknown';
    const invoiceNumber = (_unwrap(json.invoice_header?.invoice_number)) || '';
    const invoiceDateRaw = (_unwrap(json.invoice_header?.invoice_date)) || '';
    const invoiceDate = _normalizeDate(invoiceDateRaw);
    const totals = json.totals || {};
    const totalCgst = parseFloat(_unwrap(totals.total_cgst)) || 0;
    const totalSgst = parseFloat(_unwrap(totals.total_sgst)) || 0;
    const totalIgst = parseFloat(_unwrap(totals.total_igst)) || 0;
    const subtotal = parseFloat(_unwrap(totals.subtotal_before_tax)) || 0;

    const BULK_UNITS = ['kg','kgs','g','gm','gram','grams','l','ltr','litre','litres','liter','liters','ml','mt','ton','tons','tonne','tonnes','quintal','qtl','mtr','meter','meters','metre','ft','feet','sqft','mm','cm','inch','inches'];
    const assetRows = [];
    const groupInfo = [];

    const atc = json.assets_to_create || [];
    if (atc.length >= 1) {
      atc.forEach((a, i) => {
        const assetNum = nextNum++;
        const assetNumber = `AST-${String(assetNum).padStart(4,'0')}`;
        assetRows.push({
          org_id: ORG_ID, extraction_id: extraction.id, asset_number: assetNumber,
          name: a.asset_name || a.description || `Asset ${i+1}`,
          category: a.suggested_category || 'IT Equipment',
          sub_category: a.suggested_sub_category || null,
          asset_class: a.suggested_asset_class || null,
          make: a.suggested_make || null, model: a.suggested_model || null,
          serial_number: a.serial_number || serialNumbers[i] || null,
          purchase_price: a.individual_cost_before_tax || a.individual_cost_with_tax || 0,
          cgst: a.individual_cgst || 0, sgst: a.individual_sgst || 0,
          igst: a.individual_igst || 0, tax: a.individual_tax || 0,
          total_cost: a.individual_cost_with_tax || a.individual_cost_before_tax || 0,
          vendor, invoice_number: invoiceNumber, invoice_date: invoiceDate || null,
          status: 'in_review', hsn_code: a.hsn_sac_code || null,
          acquisition_date: invoiceDate || new Date().toISOString().split('T')[0],
          confidence: a.confidence_overall || extraction.confidence || 0,
          unit_of_measure: a.unit_of_measure || 'Nos',
          bulk_quantity: a.bulk_quantity || null, is_bulk_asset: a.is_bulk_asset || false,
          custom_fields: {},
        });
        groupInfo.push({
          tempId: a.temp_asset_id, action: a.group_action || 'none',
          parentTempId: a.group_parent_temp_id || null, reason: a.group_reason || null,
        });
      });
    } else {
      const lineItems = json.line_items || [];
      lineItems.forEach((li, liIdx) => {
        const rawQty = _unwrap(li.quantity) || 1;
        const unitRaw = _unwrap(li.unit) || 'Nos';
        const unitNorm = unitRaw.toLowerCase().trim().replace(/\.$/, '');
        const isBulk = BULK_UNITS.includes(unitNorm);
        const expandQty = isBulk ? 1 : Math.max(Math.round(rawQty), 1);
        const bulkQuantity = isBulk ? rawQty : null;

        const unitPrice = (_unwrap(li.unit_price) || (subtotal / Math.max(rawQty, 1))) * (isBulk ? rawQty : 1) / Math.max(expandQty, 1);
        const unitCgst = (_unwrap(li.cgst_amount) || 0) / Math.max(expandQty, 1);
        const unitSgst = (_unwrap(li.sgst_amount) || 0) / Math.max(expandQty, 1);
        const unitIgst = (_unwrap(li.igst_amount) || 0) / Math.max(expandQty, 1);
        const unitTax = unitCgst + unitSgst + unitIgst;
        const unitTotal = unitPrice + unitTax;
        const desc = _unwrap(li.description) || `Item ${liIdx+1}`;
        const hsnCode = _unwrap(li.hsn_sac_code) || '';

        for (let q = 0; q < expandQty; q++) {
          const assetNum = nextNum++;
          const assetNumber = `AST-${String(assetNum).padStart(4,'0')}`;
          assetRows.push({
            org_id: ORG_ID, extraction_id: extraction.id, asset_number: assetNumber,
            name: desc, category: 'IT Equipment',
            serial_number: serialNumbers[assetRows.length] || null,
            purchase_price: Math.round(unitPrice * 100) / 100,
            cgst: Math.round(unitCgst * 100) / 100, sgst: Math.round(unitSgst * 100) / 100,
            igst: Math.round(unitIgst * 100) / 100, tax: Math.round(unitTax * 100) / 100,
            total_cost: Math.round(unitTotal * 100) / 100,
            vendor, invoice_number: invoiceNumber, invoice_date: invoiceDate || null,
            hsn_code: hsnCode || null, status: 'in_review',
            acquisition_date: invoiceDate || new Date().toISOString().split('T')[0],
            confidence: extraction.confidence || 0,
            unit_of_measure: unitRaw, bulk_quantity: bulkQuantity, is_bulk_asset: isBulk,
            custom_fields: {},
          });
          groupInfo.push({ tempId: `tmp_${assetRows.length}`, action: _unwrap(li.group_action) || 'none', parentTempId: null, reason: null });
        }
      });
    }

    // Distribute invoice-level tax if per-asset tax is zero
    const assetTaxSum = assetRows.reduce((s, r) => s + (r.cgst || 0) + (r.sgst || 0) + (r.igst || 0), 0);
    if (assetTaxSum === 0 && (totalCgst || totalSgst || totalIgst) && assetRows.length > 0) {
      const n = assetRows.length;
      const perCgst = Math.round((totalCgst / n) * 100) / 100;
      const perSgst = Math.round((totalSgst / n) * 100) / 100;
      const perIgst = Math.round((totalIgst / n) * 100) / 100;
      const perTax = perCgst + perSgst + perIgst;
      assetRows.forEach(r => {
        r.cgst = perCgst; r.sgst = perSgst; r.igst = perIgst;
        r.tax = perTax; r.total_cost = Math.round(((r.purchase_price || 0) + perTax) * 100) / 100;
      });
    }

    // Bulk insert
    const inserted = await Supabase.insert('assets', assetRows);
    if (!inserted || inserted.length === 0) { console.error('[STORAGE] Asset insert failed'); return []; }

    // Refresh asset cache
    await this.fetchAssets();
    const createdAssets = _cache.assets.filter(a => a.extractionId === extraction.id);

    // Apply vendor custom fields
    const vendorProfile = await this.matchVendorProfile(vendor);
    if (vendorProfile) createdAssets.forEach(a => this.applyVendorCustomFields(a, vendorProfile));

    console.log(`[STORAGE] ✅ ${createdAssets.length} asset(s) created`);
    return createdAssets;
  },

  async updateAssetField(assetId, field, value) {
    if (!assetId || !field) return;
    const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
    await Supabase.update('assets', assetId, { [dbField]: value });
    const asset = this.getAsset(assetId);
    if (asset) asset[field] = value;
  },

  // ═══════════════════════════════════════════════════
  // ASSET IMAGES (Supabase Storage)
  // ═══════════════════════════════════════════════════
  async saveAssetImage(assetId, dataUrl) {
    if (!assetId || !dataUrl) return null;
    try {
      // Convert data URL to blob
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const path = `${ORG_ID}/${assetId}.jpg`;
      const url = await Supabase.uploadFile('asset-images', path, blob);
      if (url) {
        await Supabase.update('assets', assetId, { asset_image_url: url });
        const asset = this.getAsset(assetId);
        if (asset) asset.assetImageUrl = url;
      }
      return url;
    } catch(e) {
      console.error('[STORAGE] Image upload failed:', e);
      return null;
    }
  },
  saveImage(id, dataUrl) { return this.saveAssetImage(id, dataUrl); },

  getAssetImage(assetId) {
    if (!assetId) return null;
    const asset = this.getAsset(assetId);
    return (asset && asset.assetImageUrl) ? asset.assetImageUrl : null;
  },
  getImage(id) { return this.getAssetImage(id); },

  async removeAssetImage(assetId) {
    await Supabase.update('assets', assetId, { asset_image_url: null });
    const asset = this.getAsset(assetId);
    if (asset) asset.assetImageUrl = null;
  },

  // ═══════════════════════════════════════════════════
  // AUDIT TRAIL
  // ═══════════════════════════════════════════════════
  async addAuditEntry(extractionId, assetId, action, details) {
    await Supabase.insert('audit_trail', {
      extraction_id: extractionId || null, asset_id: assetId || null,
      action, notes: details, performed_by: 'user', created_at: new Date().toISOString(),
    });
  },

  async getAuditLog(entityId) {
    if (!entityId) return [];
    const byExt = await Supabase.query('audit_trail', { filters: { extraction_id: entityId }, order: 'created_at.desc' });
    const byAsset = await Supabase.query('audit_trail', { filters: { asset_id: entityId }, order: 'created_at.desc' });
    const all = [...(byExt || []), ...(byAsset || [])];
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    // Deduplicate by id
    const seen = new Set();
    return all.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
  },

  // ═══════════════════════════════════════════════════
  // VENDOR PROFILES
  // ═══════════════════════════════════════════════════
  async fetchVendorProfiles() {
    const data = await Supabase.query('vendor_profiles', { filters: { org_id: ORG_ID }, order: 'vendor_name.asc' });
    _cache.vendors = data || [];
    return _cache.vendors;
  },
  getVendorProfiles() { return _cache.vendors; },
  getVendorProfile(id) { return _cache.vendors.find(v => v.id === id) || null; },

  async saveVendorProfile(profile) {
    profile.org_id = ORG_ID;
    if (profile.id) {
      await Supabase.update('vendor_profiles', profile.id, profile);
    } else {
      const result = await Supabase.insert('vendor_profiles', profile);
      if (result && result[0]) profile.id = result[0].id;
    }
    await this.fetchVendorProfiles();
    return profile;
  },

  async deleteVendorProfile(id) {
    await Supabase.delete('vendor_profiles', id);
    await this.fetchVendorProfiles();
  },

  async matchVendorProfile(vendorName) {
    if (!vendorName) return null;
    const normalized = vendorName.toLowerCase().trim();
    if (!normalized) return null;
    const profiles = this.getVendorProfiles();
    let match = profiles.find(p => { const pn = (p.vendor_name || '').toLowerCase().trim(); return pn && pn === normalized; });
    if (!match) match = profiles.find(p => { const pn = (p.vendor_name || '').toLowerCase().trim(); return pn && (normalized.includes(pn) || pn.includes(normalized)); });
    return match || null;
  },
  matchVendorProfileSync(vendorName) { return this.matchVendorProfile(vendorName); },

  // ═══════════════════════════════════════════════════
  // TEMPLATES
  // ═══════════════════════════════════════════════════
  async fetchTemplates() {
    try {
      const data = await Supabase.query('asset_templates', { filters: { org_id: ORG_ID }, order: 'category.asc,name.asc' });
      _cache.templates = data || [];
    } catch { _cache.templates = []; }
    return _cache.templates;
  },
  getTemplates() { return _cache.templates; },

  async saveTemplate(template) {
    template.org_id = ORG_ID;
    if (template.id) {
      await Supabase.update('asset_templates', template.id, template);
    } else {
      const result = await Supabase.insert('asset_templates', template);
      if (result && result[0]) template.id = result[0].id;
    }
    await this.fetchTemplates();
    return template;
  },

  async deleteTemplate(id) {
    await Supabase.delete('asset_templates', id);
    await this.fetchTemplates();
  },

  // ═══════════════════════════════════════════════════
  // LOCATIONS & DEPARTMENTS
  // ═══════════════════════════════════════════════════
  async fetchLocations() {
    const data = await Supabase.query('locations', { filters: { org_id: ORG_ID } });
    _cache.locations = data || [];
    return _cache.locations;
  },
  getLocations() { return _cache.locations; },

  async saveLocation(loc) {
    loc.org_id = ORG_ID;
    if (loc.id) return await Supabase.update('locations', loc.id, loc);
    return await Supabase.insert('locations', loc);
  },
  async deleteLocation(id) { await Supabase.delete('locations', id); await this.fetchLocations(); },

  async fetchDepartments() {
    const data = await Supabase.query('departments', { filters: { org_id: ORG_ID } });
    _cache.departments = data || [];
    return _cache.departments;
  },
  getDepartments() { return _cache.departments; },

  async saveDepartment(dept) {
    dept.org_id = ORG_ID;
    if (dept.id) return await Supabase.update('departments', dept.id, dept);
    return await Supabase.insert('departments', dept);
  },
  async deleteDepartment(id) { await Supabase.delete('departments', id); await this.fetchDepartments(); },

  // ═══════════════════════════════════════════════════
  // LINKED INVOICES & PHYSICAL AUDITS
  // ═══════════════════════════════════════════════════
  async linkInvoice(assetId, data) {
    return await Supabase.insert('asset_invoices', {
      asset_id: assetId,
      invoice_type: data.invoice_type || data.invoiceType || 'purchase',
      invoice_number: data.invoice_number || data.invoiceNumber,
      invoice_date: data.invoice_date || data.invoiceDate,
      amount: data.amount, description: data.description,
      file_url: data.file_url || data.fileUrl,
    });
  },
  async getLinkedInvoices(assetId) {
    return await Supabase.query('asset_invoices', { filters: { asset_id: assetId }, order: 'created_at.desc' });
  },
  async getPhysicalAudits(assetId) {
    return await Supabase.query('physical_audits', { filters: { asset_id: assetId }, order: 'scanned_at.desc' });
  },

  // ═══════════════════════════════════════════════════
  // ANOMALY ALERTS
  // ═══════════════════════════════════════════════════
  async fetchAlerts() {
    return await Supabase.query('anomaly_alerts', { filters: { org_id: ORG_ID, is_resolved: false }, order: 'created_at.desc' }) || [];
  },
  async resolveAlert(alertId) {
    await Supabase.update('anomaly_alerts', alertId, { is_resolved: true, resolved_at: new Date().toISOString(), resolved_by: 'user' });
  },

  // ═══════════════════════════════════════════════════
  // DUPLICATE DETECTION
  // ═══════════════════════════════════════════════════
  async _checkDuplicateInvoice(invoiceNumber, vendorName) {
    if (!invoiceNumber) return false;
    const filters = { invoice_number: invoiceNumber, org_id: ORG_ID };
    if (vendorName) filters.vendor_name = vendorName;
    const existing = await Supabase.query('extractions', { filters });
    return existing && existing.length > 0;
  },

  async checkDuplicateSerial(serialNumber) {
    if (!serialNumber) return null;
    const existing = await Supabase.query('assets', { select: 'id,asset_number,name,serial_number', filters: { serial_number: serialNumber, org_id: ORG_ID } });
    return existing && existing.length > 0 ? existing[0] : null;
  },

  // ═══════════════════════════════════════════════════
  // DEPRECIATION
  // ═══════════════════════════════════════════════════
  calculateDepreciation(assetId) {
    const asset = this.getAsset(assetId);
    if (!asset || !asset.totalCost) return [];
    const cost = asset.totalCost;
    const method = asset.depreciationMethod || 'SLM';
    const rate = asset.depreciationRate || 10;
    const life = asset.usefulLifeYears || 5;
    const salvage = asset.salvageValue || 1;
    const acqDate = new Date(asset.acquisitionDate || asset.invoiceDate || new Date());
    const schedule = [];
    let openingValue = cost;
    let fy_start_year = acqDate.getMonth() >= 3 ? acqDate.getFullYear() : acqDate.getFullYear() - 1;
    for (let yr = 0; yr < Math.ceil(life) + 1; yr++) {
      if (openingValue <= salvage) break;
      const fyLabel = `FY ${fy_start_year + yr}-${String(fy_start_year + yr + 1).slice(-2)}`;
      let daysUsed = 365;
      if (yr === 0) {
        const fyEnd = new Date(fy_start_year + 1, 2, 31);
        const diffMs = fyEnd - acqDate;
        daysUsed = Math.max(1, Math.ceil(diffMs / (1000*60*60*24)));
        if (daysUsed > 365) daysUsed = 365;
      }
      let depAmount;
      if (method === 'WDV') depAmount = openingValue * (rate / 100) * (daysUsed / 365);
      else depAmount = ((cost - salvage) / life) * (daysUsed / 365);
      depAmount = Math.round(depAmount * 100) / 100;
      const closingValue = Math.max(Math.round((openingValue - depAmount) * 100) / 100, salvage);
      depAmount = Math.round((openingValue - closingValue) * 100) / 100;
      schedule.push({ fiscal_year: fyLabel, opening_value: openingValue, depreciation_amount: depAmount, closing_value: closingValue, method, rate, days_used: daysUsed });
      openingValue = closingValue;
    }
    return schedule;
  },

  // ═══════════════════════════════════════════════════
  // DASHBOARD STATS
  // ═══════════════════════════════════════════════════
  getDashboardStats() {
    const assets = _cache.assets;
    const extractions = _cache.extractions;
    const totalAssets = assets.length;
    const totalValue = assets.reduce((s, a) => s + (a.totalCost || 0), 0);
    const totalTax = assets.reduce((s, a) => s + (a.tax || 0), 0);
    const pending = extractions.filter(e => e.status === 'draft').length;
    const approved = extractions.filter(e => e.status === 'approved').length;
    const warrantyExpiring = assets.filter(a => {
      if (!a.warrantyEndDate) return false;
      const diff = new Date(a.warrantyEndDate) - new Date();
      return diff > 0 && diff < 30 * 24*60*60*1000;
    }).length;
    return { totalAssets, totalValue, totalTax, pending, approved, warrantyExpiring };
  },

  // ═══════════════════════════════════════════════════
  // DB ↔ FRONTEND MAPPERS
  // ═══════════════════════════════════════════════════
  _dbToExtraction(row) {
    return {
      id: row.id, fileName: row.file_name, status: row.status,
      confidence: parseFloat(row.confidence) || 0,
      extractionJson: row.extraction_json,
      vendorName: row.vendor_name, invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date, grandTotal: parseFloat(row.grand_total) || 0,
      pageCount: 1, timestamp: row.created_at, assetIds: [],
      approvedAt: row.updated_at, duplicateOf: row.duplicate_of,
    };
  },

  _extractionToDb(ext) {
    return {
      file_name: ext.fileName, status: ext.status, confidence: ext.confidence,
      extraction_json: ext.extractionJson,
      vendor_name: ext.vendorName || (_unwrap(ext.extractionJson?.vendor_details?.vendor_name)),
      invoice_number: ext.invoiceNumber || (_unwrap(ext.extractionJson?.invoice_header?.invoice_number)),
      invoice_date: ext.invoiceDate || null, grand_total: ext.grandTotal || 0,
    };
  },

  _dbToAsset(row) {
    let parentAssetNumber = null;
    if (row.parent_asset_id) {
      const parent = _cache.assets.find(a => a.id === row.parent_asset_id);
      parentAssetNumber = parent ? parent.assetNumber : 0;
    }
    // Short display name: first 40 chars
    const fullName = row.name || '';
    const shortName = fullName.length > 50 ? fullName.substring(0, 47) + '...' : fullName;

    return {
      id: row.id, extractionId: row.extraction_id,
      assetId: row.asset_id, // 10-digit numeric ID
      assetNumber: parseInt((row.asset_number || '').replace(/\D/g, '')) || 0,
      tempAssetId: row.asset_number,
      name: fullName, shortName,
      description: row.description, category: row.category,
      subCategory: row.sub_category, assetClass: row.asset_class,
      make: row.make, model: row.model,
      serialNumber: row.serial_number, barcode: row.barcode,
      qrCodeData: row.qr_code_data, hsnCode: row.hsn_code,
      purchasePrice: parseFloat(row.purchase_price) || 0,
      cgst: parseFloat(row.cgst) || 0, sgst: parseFloat(row.sgst) || 0,
      igst: parseFloat(row.igst) || 0, tax: parseFloat(row.tax) || 0,
      totalCost: parseFloat(row.total_cost) || 0,
      vendor: row.vendor, invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date, acquisitionDate: row.acquisition_date,
      parentAssetId: row.parent_asset_id, parentAssetNumber,
      childIndex: row.child_index, groupReason: row.group_reason,
      unitOfMeasure: row.unit_of_measure || 'Nos',
      bulkQuantity: row.bulk_quantity ? parseFloat(row.bulk_quantity) : null,
      isBulkAsset: row.is_bulk_asset || false,
      locationId: row.location_id, departmentId: row.department_id,
      assignedTo: row.assigned_to, costCenter: row.cost_center,
      usefulLifeYears: row.useful_life_years ? parseFloat(row.useful_life_years) : null,
      depreciationMethod: row.depreciation_method || 'SLM',
      depreciationRate: row.depreciation_rate ? parseFloat(row.depreciation_rate) : null,
      salvageValue: row.salvage_value ? parseFloat(row.salvage_value) : 1,
      warrantyStartDate: row.warranty_start_date, warrantyEndDate: row.warranty_end_date,
      warrantyProvider: row.warranty_provider,
      amcStartDate: row.amc_start_date, amcEndDate: row.amc_end_date,
      amcProvider: row.amc_provider, amcCost: row.amc_cost ? parseFloat(row.amc_cost) : null,
      status: row.status, verificationDate: row.verification_date,
      verifiedBy: row.verified_by, assetImageUrl: row.asset_image_url,
      confidence: parseFloat(row.confidence) || 0,
      customFields: row.custom_fields || {}, tags: row.tags || [],
      createdAt: row.created_at,
    };
  },

  _assetToDb(asset) {
    return {
      name: asset.name, description: asset.description,
      category: asset.category, sub_category: asset.subCategory,
      asset_class: asset.assetClass, make: asset.make, model: asset.model,
      serial_number: asset.serialNumber, hsn_code: asset.hsnCode,
      barcode: asset.barcode, qr_code_data: asset.qrCodeData,
      purchase_price: asset.purchasePrice,
      cgst: asset.cgst, sgst: asset.sgst, igst: asset.igst,
      tax: asset.tax, total_cost: asset.totalCost,
      vendor: asset.vendor, invoice_number: asset.invoiceNumber,
      invoice_date: asset.invoiceDate, acquisition_date: asset.acquisitionDate,
      parent_asset_id: asset.parentAssetId || null,
      child_index: asset.childIndex, group_reason: asset.groupReason,
      unit_of_measure: asset.unitOfMeasure,
      bulk_quantity: asset.bulkQuantity, is_bulk_asset: asset.isBulkAsset,
      status: asset.status, assigned_to: asset.assignedTo,
      cost_center: asset.costCenter,
      location_id: asset.locationId || null,
      department_id: asset.departmentId || null,
      useful_life_years: asset.usefulLifeYears,
      depreciation_method: asset.depreciationMethod,
      depreciation_rate: asset.depreciationRate,
      salvage_value: asset.salvageValue,
      warranty_start_date: asset.warrantyStartDate,
      warranty_end_date: asset.warrantyEndDate,
      warranty_provider: asset.warrantyProvider,
      amc_start_date: asset.amcStartDate, amc_end_date: asset.amcEndDate,
      amc_provider: asset.amcProvider, amc_cost: asset.amcCost,
      verification_date: asset.verificationDate,
      verified_by: asset.verifiedBy,
      asset_image_url: asset.assetImageUrl,
      confidence: asset.confidence,
      custom_fields: asset.customFields, tags: asset.tags,
    };
  },

  // ═══════════════════════════════════════════════════
  // VENDOR CUSTOM FIELD HELPERS
  // ═══════════════════════════════════════════════════
  applyVendorCustomFields(asset, vendorProfile) {
    if (!vendorProfile || !asset) return;
    const cf = {};
    (vendorProfile.custom_fields || []).forEach(f => {
      cf[f.key] = { label: f.label, value: f.defaultValue || '', type: f.type || 'text', options: f.options || [] };
    });
    asset.customFields = { ...cf, ...(asset.customFields || {}) };
    return asset;
  },

  // ═══════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════
  async init() {
    console.log('🔄 Initializing Storage from Supabase...');
    try {
      await Promise.all([
        this.fetchExtractions().catch(e => console.warn('⚠️ Extractions:', e)),
        this.fetchAssets().catch(e => console.warn('⚠️ Assets:', e)),
        this.fetchVendorProfiles().catch(e => console.warn('⚠️ Vendors:', e)),
        this.fetchTemplates().catch(e => console.warn('⚠️ Templates:', e)),
        this.fetchLocations().catch(e => console.warn('⚠️ Locations:', e)),
        this.fetchDepartments().catch(e => console.warn('⚠️ Departments:', e)),
      ]);
    } catch(e) { console.error('❌ Init failed:', e); }
    // Re-populate assetIds after both are loaded
    _cache.extractions.forEach(ext => {
      ext.assetIds = _cache.assets.filter(a => a.extractionId === ext.id).map(a => a.id);
    });
    console.log(`✅ Storage ready: ${_cache.extractions.length} extractions, ${_cache.assets.length} assets`);
  },

  // ═══════════════════════════════════════════════════
  // CLEAR ALL
  // ═══════════════════════════════════════════════════
  async clearAll() {
    try {
      await Supabase.deleteWhere('physical_audits');
      await Supabase.deleteWhere('depreciation_entries');
      await Supabase.deleteWhere('asset_invoices');
      await Supabase.deleteWhere('anomaly_alerts');
      await Supabase.deleteWhere('audit_trail');
      await Supabase.deleteWhere('assets');
      await Supabase.deleteWhere('extractions');
      await Supabase.deleteWhere('vendor_profiles');
    } catch(e) { console.warn('clearAll error:', e); }
    _cache.extractions = [];
    _cache.assets = [];
    _cache.vendors = [];
    // Clear settings only
    try { localStorage.removeItem('ac_settings'); } catch {}
  },
};

window.Storage = Storage;
