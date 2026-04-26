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
    return { apiUrl: 'http://localhost:8000', tenantId: 'poc', apiKey: '' };
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

  /**
   * Create extraction from VLM-OCR response envelope.
   * @param {string} fileName - uploaded file name
   * @param {object} vlmResponse - full VLM-OCR response { success, data, assets, metadata }
   */
  async createExtraction(fileName, vlmResponse) {
    console.log('%c[STORAGE] 📥 createExtraction (VLM-OCR) starting...', 'color:#005da9;font-weight:bold');

    const rawData = vlmResponse.data || {};       // { page_1: {...}, page_2: {...} }
    const generatedAssets = vlmResponse.assets || [];  // IndividualAsset[]
    const metadata = vlmResponse.metadata || {};

    // Extract header info from the first page
    const firstPageKey = Object.keys(rawData).sort()[0] || 'page_1';
    const firstPage = rawData[firstPageKey] || {};
    const header = firstPage.header || {};
    const footer = firstPage.footer || {};

    const vendorName = header.vnd_name || header.vendor || 'Unknown';
    const invoiceNumber = header.inv_no || '';
    const invoiceDateRaw = header.inv_dt || null;
    const invoiceDate = _normalizeDate(invoiceDateRaw);
    const grandTotalRaw = (footer.total || header.cost || '0').toString().replace(/[^\d.]/g, '');
    const grandTotal = parseFloat(grandTotalRaw) || 0;
    const pageCount = metadata.page_count || Object.keys(rawData).length || 1;
    const confidence = generatedAssets.length > 0
      ? generatedAssets.reduce((s, a) => s + (a.title_confidence || 0), 0) / generatedAssets.length
      : 0;

    // Check for duplicates
    const isDuplicate = await this._checkDuplicateInvoice(invoiceNumber, vendorName, grandTotal, invoiceDate);

    const extraction = {
      id: crypto.randomUUID(),
      fileName, 
      extractionJson: rawData,       // The { page_1, page_2 } object
      generatedAssets,              // The IndividualAsset[] array
      extractionMetadata: metadata,
      extractionType: 'standard',
      confidence, pageCount,
      vendorName, invoiceNumber, invoiceDate, grandTotal,
      status: 'draft',
      timestamp: new Date().toISOString(),
      assetIds: [],
    };

    // Insert extraction to DB
    await Supabase.insert('extractions', {
      id: extraction.id, org_id: ORG_ID, file_name: fileName, status: 'draft',
      extraction_type: 'standard',
      confidence, extraction_json: rawData, generated_assets: generatedAssets,
      vendor_name: vendorName, invoice_number: invoiceNumber,
      invoice_date: invoiceDate, grand_total: grandTotal,
      currency: header.currency || 'INR',
      po_number: header.po_no || null,
      extraction_metadata: metadata,
      duplicate_of: typeof isDuplicate === 'string' ? isDuplicate : null,
    });

    // Expand VLM-OCR generated assets into individual asset rows
    const assets = await this._expandVlmAssets(extraction, generatedAssets);
    extraction.assetIds = assets.map(a => a.id);

    // Check serial number duplicates across generated assets
    for (const asset of generatedAssets) {
      if (asset.serial_number) {
        const existingAsset = await this.checkDuplicateSerial(asset.serial_number);
        if (existingAsset) {
          await Supabase.insert('anomaly_alerts', {
            org_id: ORG_ID, alert_type: 'duplicate_serial', severity: 'high',
            title: `Duplicate serial number: ${asset.serial_number}`,
            description: `Serial ${asset.serial_number} already registered as asset ${existingAsset.asset_number || existingAsset.id}.`,
            related_extraction_id: extraction.id,
          });
        }
      }
    }

    // Duplicate invoice alert
    if (isDuplicate) {
      await Supabase.insert('anomaly_alerts', {
        org_id: ORG_ID, alert_type: 'duplicate_invoice', severity: 'high',
        title: `Possible duplicate: Invoice #${invoiceNumber}`,
        description: `Invoice #${invoiceNumber} from ${vendorName} (₹${grandTotal}) may already exist.`,
        related_extraction_id: extraction.id,
      });
      extraction.duplicateOf = typeof isDuplicate === 'string' ? isDuplicate : 'duplicate';
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
    // Fetch ALL asset numbers to find the true maximum, avoiding duplicates
    const result = await Supabase.query('assets', { select: 'asset_number', filters: { org_id: ORG_ID }, order: 'asset_number.desc', limit: 1 });
    if (result && result.length > 0) {
      const m = (result[0].asset_number || '').match(/^AST-(\d+)$/);
      if (m) return parseInt(m[1]) + 1;
    }
    return 1001;
  },

  _splitSerials(raw) {
    // Normalize a serial string or array — splits slash-separated values the VLM returns as one string
    const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const out = [];
    arr.forEach(s => {
      if (s && s.includes('/')) s.split('/').forEach(p => { if (p.trim()) out.push(p.trim()); });
      else if (s) out.push(s);
    });
    return out;
  },

  _parseSerialNumbers(json) {
    const serials = [];
    (json.assets_to_create || []).forEach(a => { if (a.serial_number) serials.push(a.serial_number); });
    if (serials.length > 0) return this._splitSerials(serials);
    (json.line_items || []).forEach(li => {
      if (li.serial_numbers_listed && Array.isArray(li.serial_numbers_listed))
        li.serial_numbers_listed.forEach(s => serials.push(s));
    });
    return this._splitSerials(serials);
  },

  /**
   * Expand VLM-OCR generated assets into individual asset rows.
   * This replaces the old _expandAssets — VLM-OCR Stage 2 already does
   * the heavy lifting (splitting, grouping, math distribution).
   */
  async _expandVlmAssets(extraction, generatedAssets) {
    if (!generatedAssets || generatedAssets.length === 0) return [];

    let nextNum = await this._getNextAssetNumber();
    const assetRows = [];

    // Extract vendor/invoice from extraction header
    const rawData = extraction.extractionJson || {};
    const firstPageKey = Object.keys(rawData).sort()[0] || 'page_1';
    const firstPage = rawData[firstPageKey] || {};
    const header = firstPage.header || {};
    const vendor = header.vnd_name || header.vendor || extraction.vendorName || 'Unknown';
    const invoiceNumber = header.inv_no || extraction.invoiceNumber || '';
    const invoiceDate = _normalizeDate(header.inv_dt) || extraction.invoiceDate || null;

    // Build flat table rows for HSN lookup by source_line_index
    const allTableRows = [];
    for (const pk of Object.keys(rawData).sort()) {
      if (pk.startsWith('page_')) {
        const pg = rawData[pk];
        if (pg.tables && Array.isArray(pg.tables)) {
          pg.tables.forEach(t => {
            if (Array.isArray(t)) allTableRows.push(...t);
            else if (t.rows && Array.isArray(t.rows)) allTableRows.push(...t.rows);
          });
        }
      }
    }

    for (let i = 0; i < generatedAssets.length; i++) {
      const a = generatedAssets[i];
      const assetNum = nextNum++;
      const assetNumber = `AST-${String(assetNum).padStart(4, '0')}`;

      // Map category suggestion
      const catSuggestion = a.category_suggestion || {};

      // Parse cost — handle string values like "60000/-"
      const costRaw = a.cost || a.total_amount || 0;
      const cost = typeof costRaw === 'string' ? parseFloat(costRaw.replace(/[^\d.]/g, '')) || 0 : costRaw;
      const totalAmount = typeof a.total_amount === 'string' ? parseFloat(a.total_amount.toString().replace(/[^\d.]/g, '')) || 0 : (a.total_amount || cost);

      // Parse taxes (deterministic from Python, NOT LLM)
      const taxes = a.taxes || {};
      const cgst = parseFloat(taxes.cgst) || 0;
      const sgst = parseFloat(taxes.sgst) || 0;
      const igst = parseFloat(taxes.igst) || 0;
      const totalTax = cgst + sgst + igst;

      assetRows.push({
        org_id: ORG_ID,
        extraction_id: extraction.id,
        asset_number: assetNumber,
        dummy_asset_number: a.dummy_asset_number || null,

        // Core identity
        name: a.title || a.description || `Asset ${i + 1}`,
        name_confidence: a.title_confidence || 1.0,
        description: a.description || a.title || '',
        description_confidence: a.description_confidence || 1.0,

        // Classification
        category: catSuggestion.category || firstPage.asset_category || 'IT Equipment',
        sub_category: catSuggestion.subcategory || firstPage.asset_sub_category || null,
        make: catSuggestion.make || a.manufacturer || firstPage.manufacturer || null,
        model: catSuggestion.model || firstPage.asset_make_model || null,
        category_confidence: a.category_suggestion_confidence || 1.0,

        // Identification
        serial_number: a.serial_number || firstPage.serial_number || null,
        hsn_code: a.hsn_code || (() => {
          const lineIdx = a.invoice_provenance?.source_line_index;
          if (lineIdx !== undefined && allTableRows[lineIdx]) {
            return allTableRows[lineIdx].hsn_code || allTableRows[lineIdx].hsn || allTableRows[lineIdx].hsn_sac || null;
          }
          return null;
        })(),

        // Financials (mathematically distributed by VLM-OCR Python)
        purchase_price: cost,
        cost_confidence: a.cost_confidence || 1.0,
        cgst, sgst, igst,
        tax: totalTax,
        taxes_detail: taxes,
        taxes_confidence: a.taxes_confidence || 1.0,
        installation_charges: a.installation_charges || 0,
        installation_confidence: a.installation_charges_confidence || 1.0,
        total_cost: totalAmount,
        currency: a.currency || firstPage.currency || 'INR',

        // Invoice metadata
        vendor, invoice_number: invoiceNumber, invoice_date: _normalizeDate(invoiceDate),
        acquisition_date: _normalizeDate(invoiceDate) || new Date().toISOString().split('T')[0],

        // Parent-child relationships
        is_parent_asset: a.is_parent_asset !== undefined ? a.is_parent_asset : true,
        is_parent_confidence: a.is_parent_asset_confidence || 1.0,
        parent_asset_dummy_number: a.parent_asset_dummy_number || null,
        asset_group_id: a.asset_group_id || null,

        // Tracking config (from VLM-OCR rules engine)
        tracking_config: a.tracking_config || {},
        tracking_config_confidence: a.tracking_config?.confidence || 1.0,
        tracking_config_source: 'rules',

        // Invoice provenance
        invoice_provenance: a.invoice_provenance || {},

        // Condition
        condition: a.condition || firstPage.asset_condition || 'New',
        condition_source: a.condition_source || 'default',

        // Source
        source: 'invoice',
        status: 'in_review',

        // VLM-OCR V1.4 Additional Fields
        po_number: firstPage.po_number || header.buy_po_no || null,
        po_date: _normalizeDate(firstPage.po_date || header.buy_po_dt) || null,
        grn_number: firstPage.grn_number || null,
        grn_date: _normalizeDate(firstPage.grn_date) || null,
        pr_number: firstPage.pr_number || null,
        asset_nature: firstPage.asset_nature || null,
        insurance_start_date: _normalizeDate(firstPage.insurance_start_date) || null,
        insurance_end_date: _normalizeDate(firstPage.insurance_end_date) || null,
        insurance_number: firstPage.insurance_number || null,
        insurance_vendor: firstPage.insurance_vendor || null,
        lease_start_date: _normalizeDate(firstPage.lease_start_date) || null,
        lease_end_date: _normalizeDate(firstPage.lease_end_date) || null,
        lease_cost: firstPage.lease_cost ? parseFloat(firstPage.lease_cost.toString().replace(/[^\d.]/g, '')) : null,
        lease_contract_number: firstPage.lease_contract_number || null,
        lease_vendor: firstPage.lease_vendor || null,
        asset_expiry_date: _normalizeDate(firstPage.asset_expiry_date) || null,
        nbv: firstPage.nbv ? parseFloat(firstPage.nbv.toString().replace(/[^\d.]/g, '')) : null,
        nbv_date: _normalizeDate(firstPage.nbv_date) || null,
        put_to_use_date: _normalizeDate(firstPage.put_to_use_date) || null,
        residual_value: firstPage.residual_value ? parseFloat(firstPage.residual_value.toString().replace(/[^\d.]/g, '')) : null,
        residual_value_percentage: firstPage.residual_value_percentage ? parseFloat(firstPage.residual_value_percentage.toString().replace(/[^\d.]/g, '')) : null,
        installation_date: _normalizeDate(firstPage.installation_date) || null,
        business_segment: firstPage.business_segment || null,
        group_name: firstPage.group || null,
        legal_entity: firstPage.legal_entity || null,
        controlling_region: firstPage.controlling_region || null,
        profit_center: firstPage.profit_center || null,
        sub_location: firstPage.sub_location || null,
        last_scan_latitude: firstPage.last_scan_latitude ? parseFloat(firstPage.last_scan_latitude) : null,
        last_scan_longitude: firstPage.last_scan_longitude ? parseFloat(firstPage.last_scan_longitude) : null,
        location_radius: firstPage.location_radius ? parseFloat(firstPage.location_radius) : null,
        allocated_to: firstPage.allocated_to || null,
        asset_status_date: _normalizeDate(firstPage.asset_status_date) || null,
        asset_condition_date: _normalizeDate(firstPage.asset_condition_date) || null,
        last_scan_date: _normalizeDate(firstPage.last_scan_date) || null,
        last_scan_city: firstPage.last_scan_city || null,
        asset_created_by: firstPage.asset_created_by || null,
        asset_geo_fence_status: firstPage.asset_geo_fence_status || null,
        assignee_type: firstPage.assignee_type || null,
        old_asset_number: firstPage.old_asset_number || null,

        // Overall confidence
        confidence: a.title_confidence || extraction.confidence || 0,

        custom_fields: (() => {
          const c = {
            'PO Date': firstPage.po_date || header.buy_po_dt || '',
            'PO Number': firstPage.po_number || header.buy_po_no || '',
            'Audit Indicator': firstPage.audit_indicator || a.tracking_config?.indicator || '',
            'Audit Method': firstPage.audit_method || (a.tracking_config?.audit_methods ? a.tracking_config.audit_methods.join(', ') : ''),
            'Acquisition Date': firstPage.acquisition_date || '',
            'Asset Created On': firstPage.asset_created_on || '',
            'Asset Class': firstPage.asset_class || '',
            'Department': firstPage.department || '',
            'Asset Nature': firstPage.asset_nature || '',
            'Asset Criticality': firstPage.asset_criticality || '',
            'Insurance Start Date': firstPage.insurance_start_date || '',
            'AMC Start Date': firstPage.amc_start_date || '',
            'Insurance End Date': firstPage.insurance_end_date || '',
            'AMC End Date': firstPage.amc_end_date || '',
            'Warranty Start Date': firstPage.warranty_start_date || a.warranty_start_date || '',
            'Warranty Expiry Date': firstPage.warranty_expiry_date || a.warranty_expiry_date || '',
            'Lease Start Date': firstPage.lease_start_date || '',
            'Lease End Date': firstPage.lease_end_date || '',
            'Insurance Number': firstPage.insurance_number || '',
            'AMC Number': firstPage.amc_number || '',
            'Insurance Vendor': firstPage.insurance_vendor || '',
            'AMC Vendor': firstPage.amc_vendor || '',
            'Lease Cost': firstPage.lease_cost || '',
            'Lease Contract Number': firstPage.lease_contract_number || '',
            'Lease Vendor': firstPage.lease_vendor || '',
            'Asset Expiry Date': firstPage.asset_expiry_date || '',
            'NBV': firstPage.nbv || '',
            'Useful Life': firstPage.useful_life || '',
            'NBV Date': firstPage.nbv_date || '',
            'Put to Use date': firstPage.put_to_use_date || '',
            'Residual Value': firstPage.residual_value || '',
            'Installation Date': firstPage.installation_date || '',
            'Business Segment': firstPage.business_segment || '',
            'Cost Center': firstPage.cost_center || '',
            'Group': firstPage.group || '',
            'Legal Entity': firstPage.legal_entity || '',
            'Controlling Region': firstPage.controlling_region || '',
            'Plant/Location': firstPage.plant_location || a.plant_location || '',
            'Profit Center': firstPage.profit_center || '',
            'Sub Location': firstPage.sub_location || '',
            'Last Scan Latitude': firstPage.last_scan_latitude || '',
            'Last Scan Longitude': firstPage.last_scan_longitude || '',
            'Location Radius': firstPage.location_radius || '',
            'GRN Date': firstPage.grn_date || '',
            'GRN Number': firstPage.grn_number || '',
            'Allocated To': firstPage.allocated_to || '',
            'PR Number': firstPage.pr_number || '',
            'Asset Status': firstPage.asset_status || '',
            'Asset Status Date': firstPage.asset_status_date || '',
            'Asset Condition': firstPage.asset_condition || a.condition || '',
            'Asset Condition Date': firstPage.asset_condition_date || '',
            'Last Scan Date': firstPage.last_scan_date || '',
            'Last Scan City': firstPage.last_scan_city || '',
            'Asset Created By': firstPage.asset_created_by || '',
            'Asset Geo Fence Status': firstPage.asset_geo_fence_status || '',
            'Assignee Type': firstPage.assignee_type || '',
            'Residual Value Percentage': firstPage.residual_value_percentage || ''
          };
          Object.keys(c).forEach(k => {
            if (c[k] === null || c[k] === undefined || c[k] === '') {
              delete c[k];
            }
          });
          return c;
        })(),
      });
    }

    // Bulk insert
    const inserted = await Supabase.insert('assets', assetRows);
    if (!inserted || inserted.length === 0) { console.error('[STORAGE] Asset insert failed'); return []; }

    // Refresh asset cache
    await this.fetchAssets();
    const createdAssets = _cache.assets.filter(a => a.extractionId === extraction.id);

    // Apply vendor custom fields if matched
    const vendorProfile = await this.matchVendorProfile(vendor);
    if (vendorProfile) createdAssets.forEach(a => this.applyVendorCustomFields(a, vendorProfile));

    console.log(`[STORAGE] ✅ ${createdAssets.length} asset(s) created from VLM-OCR`);
    return createdAssets;
  },

  // Legacy fallback — kept for backward compatibility with old response format
  async _expandAssets(extraction) {
    // If generatedAssets is already present, use VLM-OCR path
    if (extraction.generatedAssets && extraction.generatedAssets.length > 0) {
      return this._expandVlmAssets(extraction, extraction.generatedAssets);
    }
    console.warn('[STORAGE] No VLM-OCR generated assets found, skipping expansion.');
    return [];
  },

  async updateAssetField(assetId, field, value) {
    if (!assetId || !field) return;
    const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
    await Supabase.update('assets', assetId, { [dbField]: value });
    const asset = this.getAsset(assetId);
    if (asset) asset[field] = value;
  },

  async updateAssetCustomField(assetId, customKey, value) {
    if (!assetId || !customKey) return;
    const asset = this.getAsset(assetId);
    if (!asset) return;
    
    // Ensure customFields exists
    if (!asset.customFields) asset.customFields = {};
    asset.customFields[customKey] = value;
    
    // Update the jsonb column in Supabase
    await Supabase.update('assets', assetId, { custom_fields: asset.customFields });
  },

  // ═══════════════════════════════════════════════════
  // ASSET IMAGES (Supabase Storage)
  // ═══════════════════════════════════════════════════
  async saveAssetImage(assetId, dataUrl) {
    if (!assetId || !dataUrl) return null;
    try {
      // Try Supabase Storage first
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const path = `${ORG_ID}/${assetId}.jpg`;
      const url = await Supabase.uploadFile('asset-images', path, blob);
      const finalUrl = url || dataUrl; // fall back to base64 data URL if bucket missing/unavailable
      await Supabase.update('assets', assetId, { asset_image_url: finalUrl });
      const asset = this.getAsset(assetId);
      if (asset) asset.assetImageUrl = finalUrl;
      return finalUrl;
    } catch(e) {
      // Last resort: save the data URL directly
      try {
        await Supabase.update('assets', assetId, { asset_image_url: dataUrl });
        const asset = this.getAsset(assetId);
        if (asset) asset.assetImageUrl = dataUrl;
        return dataUrl;
      } catch(e2) {
        console.error('[STORAGE] Image save failed:', e2);
        return null;
      }
    }
  },
  saveImage(id, dataUrl) { return this.saveAssetImage(id, dataUrl); },

  async saveInvoiceFile(extractionId, file) {
    if (!extractionId || !file) return null;
    try {
      const ext = file.name ? file.name.split('.').pop().toLowerCase() : 'bin';
      const path = `${ORG_ID}/${extractionId}.${ext}`;
      const url = await Supabase.uploadFile('invoice-images', path, file);
      if (url) {
        await Supabase.update('extractions', extractionId, { file_url: url });
        const cached = this.getExtraction(extractionId);
        if (cached) cached.fileUrl = url;
      }
      return url;
    } catch (e) {
      console.error('[STORAGE] Invoice file upload failed:', e);
      return null;
    }
  },

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

  // ── BARCODE / NAMEPLATE IMAGE ──
  async saveBarcodeImage(assetId, dataUrl) {
    if (!assetId || !dataUrl) return null;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const path = `${ORG_ID}/${assetId}_barcode.jpg`;
      const url = await Supabase.uploadFile('asset-images', path, blob);
      const finalUrl = url || dataUrl;
      await Supabase.update('assets', assetId, { barcode_image_url: finalUrl });
      const asset = this.getAsset(assetId);
      if (asset) asset.barcodeImageUrl = finalUrl;
      return finalUrl;
    } catch(e) {
      try {
        await Supabase.update('assets', assetId, { barcode_image_url: dataUrl });
        const asset = this.getAsset(assetId);
        if (asset) asset.barcodeImageUrl = dataUrl;
        return dataUrl;
      } catch(e2) {
        console.error('[STORAGE] Barcode image save failed:', e2);
        return null;
      }
    }
  },

  getBarcodeImage(assetId) {
    if (!assetId) return null;
    const asset = this.getAsset(assetId);
    return (asset && asset.barcodeImageUrl) ? asset.barcodeImageUrl : null;
  },

  async removeBarcodeImage(assetId) {
    await Supabase.update('assets', assetId, { barcode_image_url: null });
    const asset = this.getAsset(assetId);
    if (asset) asset.barcodeImageUrl = null;
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
  matchVendorProfileSync(vendorName) {
    if (!vendorName) return null;
    const normalized = vendorName.toLowerCase().trim();
    const profiles = this.getVendorProfiles();
    let match = profiles.find(p => { const pn = (p.vendor_name || '').toLowerCase().trim(); return pn && pn === normalized; });
    if (!match) match = profiles.find(p => { const pn = (p.vendor_name || '').toLowerCase().trim(); return pn && (normalized.includes(pn) || pn.includes(normalized)); });
    return match || null;
  },

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
  async _checkDuplicateInvoice(invoiceNumber, vendorName, grandTotal, invoiceDate) {
    // Match 1: same invoice number + vendor (strongest signal)
    if (invoiceNumber) {
      const filters = { invoice_number: invoiceNumber, org_id: ORG_ID };
      if (vendorName) filters.vendor_name = vendorName;
      const existing = await Supabase.query('extractions', { filters });
      if (existing && existing.length > 0) return existing[0].id;
    }
    // Match 2: same vendor + same grand total + same invoice date (re-upload with no inv# change)
    if (vendorName && grandTotal > 0 && invoiceDate) {
      const existing2 = await Supabase.query('extractions', {
        filters: { vendor_name: vendorName, grand_total: grandTotal, invoice_date: invoiceDate, org_id: ORG_ID }
      });
      if (existing2 && existing2.length > 0) return existing2[0].id;
    }
    return false;
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
      generatedAssets: row.generated_assets || [],
      extractionType: row.extraction_type || 'standard',
      extractionMetadata: row.extraction_metadata || {},
      preciseRows: row.precise_rows || null,
      pageAnalyses: row.page_analyses || null,
      invoiceGroups: row.invoice_groups || null,
      invoiceSummary: row.invoice_summary || null,
      vendorName: row.vendor_name, invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date, grandTotal: parseFloat(row.grand_total) || 0,
      poNumber: row.po_number || null,
      currency: row.currency || 'INR',
      mathValidation: row.math_validation || {},
      pageCount: row.extraction_metadata?.page_count || 1,
      timestamp: row.created_at, assetIds: [],
      approvedAt: row.updated_at, duplicateOf: row.duplicate_of,
      fileUrl: row.file_url || null,
    };
  },

  _extractionToDb(ext) {
    return {
      file_name: ext.fileName, status: ext.status, confidence: ext.confidence,
      extraction_type: ext.extractionType || 'standard',
      extraction_json: ext.extractionJson,
      generated_assets: ext.generatedAssets || null,
      extraction_metadata: ext.extractionMetadata || null,
      precise_rows: ext.preciseRows || null,
      page_analyses: ext.pageAnalyses || null,
      invoice_groups: ext.invoiceGroups || null,
      invoice_summary: ext.invoiceSummary || null,
      vendor_name: ext.vendorName, invoice_number: ext.invoiceNumber,
      invoice_date: ext.invoiceDate || null, grand_total: ext.grandTotal || 0,
      po_number: ext.poNumber || null, currency: ext.currency || 'INR',
    };
  },

  _dbToAsset(row) {
    let parentAssetNumber = null;
    if (row.parent_asset_id) {
      const parent = _cache.assets.find(a => a.id === row.parent_asset_id);
      parentAssetNumber = parent ? parent.assetNumber : 0;
    }
    // Short display name: first 50 chars
    const fullName = row.name || '';
    const shortName = fullName.length > 50 ? fullName.substring(0, 47) + '...' : fullName;

    return {
      id: row.id, extractionId: row.extraction_id,
      assetId: row.asset_id, // 10-digit numeric ID
      assetNumber: parseInt((row.asset_number || '').replace(/\D/g, '')) || 0,
      tempAssetId: row.asset_number,
      dummyAssetNumber: row.dummy_asset_number || null,
      name: fullName, shortName,
      nameConfidence: parseFloat(row.name_confidence) || 1.0,
      description: row.description,
      descriptionConfidence: parseFloat(row.description_confidence) || 1.0,
      category: row.category,
      subCategory: row.sub_category, assetClass: row.asset_class,
      assetType: row.asset_type, assetCriticality: row.asset_criticality,
      categoryConfidence: parseFloat(row.category_confidence) || 1.0,
      make: row.make, model: row.model,
      serialNumber: row.serial_number, barcode: row.barcode,
      barcodeRawData: row.barcode_raw_data,
      qrCodeData: row.qr_code_data, hsnCode: row.hsn_code,
      purchasePrice: parseFloat(row.purchase_price) || 0,
      costConfidence: parseFloat(row.cost_confidence) || 1.0,
      cgst: parseFloat(row.cgst) || 0, sgst: parseFloat(row.sgst) || 0,
      igst: parseFloat(row.igst) || 0, tax: parseFloat(row.tax) || 0,
      taxesDetail: row.taxes_detail || {},
      taxesConfidence: parseFloat(row.taxes_confidence) || 1.0,
      installationCharges: parseFloat(row.installation_charges) || 0,
      installationConfidence: parseFloat(row.installation_confidence) || 1.0,
      totalCost: parseFloat(row.total_cost) || 0,
      currency: row.currency || 'INR',
      vendor: row.vendor, invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date, acquisitionDate: row.acquisition_date,
      parentAssetId: row.parent_asset_id, parentAssetNumber,
      parentAssetDummyNumber: row.parent_asset_dummy_number,
      assetGroupId: row.asset_group_id,
      childIndex: row.child_index, groupReason: row.group_reason,
      isParentAsset: row.is_parent_asset !== false,
      isParentConfidence: parseFloat(row.is_parent_confidence) || 1.0,
      unitOfMeasure: row.unit_of_measure || 'Nos',
      bulkQuantity: row.bulk_quantity ? parseFloat(row.bulk_quantity) : null,
      isBulkAsset: row.is_bulk_asset || false,
      locationId: row.location_id, departmentId: row.department_id,
      plantLocation: row.plant_location,
      assignedTo: row.assigned_to, costCenter: row.cost_center,
      usefulLifeYears: row.useful_life_years ? parseFloat(row.useful_life_years) : null,
      depreciationMethod: row.depreciation_method || 'SLM',
      depreciationRate: row.depreciation_rate ? parseFloat(row.depreciation_rate) : null,
      salvageValue: row.salvage_value ? parseFloat(row.salvage_value) : 1,
      warrantyStartDate: row.warranty_start_date, warrantyEndDate: row.warranty_end_date,
      warrantyProvider: row.warranty_provider, warrantyNumber: row.warranty_number,
      amcStartDate: row.amc_start_date, amcEndDate: row.amc_end_date,
      amcProvider: row.amc_provider, amcNumber: row.amc_number, amcCost: row.amc_cost ? parseFloat(row.amc_cost) : null,
      condition: row.condition || 'New',
      conditionSource: row.condition_source || 'default',
      conditionDetails: row.condition_details,
      trackingConfig: row.tracking_config || {},
      trackingConfigConfidence: parseFloat(row.tracking_config_confidence) || 1.0,
      trackingConfigSource: row.tracking_config_source || 'rules',
      invoiceProvenance: row.invoice_provenance || {},
      source: row.source || 'invoice',
      poNumber: row.po_number, poDate: row.po_date,
      grnNumber: row.grn_number, grnDate: row.grn_date,
      prNumber: row.pr_number, assetNature: row.asset_nature,
      insuranceStartDate: row.insurance_start_date, insuranceEndDate: row.insurance_end_date,
      insuranceNumber: row.insurance_number, insuranceVendor: row.insurance_vendor,
      leaseStartDate: row.lease_start_date, leaseEndDate: row.lease_end_date,
      leaseCost: row.lease_cost, leaseContractNumber: row.lease_contract_number, leaseVendor: row.lease_vendor,
      assetExpiryDate: row.asset_expiry_date, nbv: row.nbv, nbvDate: row.nbv_date,
      putToUseDate: row.put_to_use_date, residualValue: row.residual_value,
      residualValuePercentage: row.residual_value_percentage, installationDate: row.installation_date,
      businessSegment: row.business_segment, groupName: row.group_name,
      legalEntity: row.legal_entity, controllingRegion: row.controlling_region,
      profitCenter: row.profit_center, subLocation: row.sub_location,
      lastScanLatitude: row.last_scan_latitude, lastScanLongitude: row.last_scan_longitude,
      locationRadius: row.location_radius, allocatedTo: row.allocated_to,
      assetStatusDate: row.asset_status_date, assetConditionDate: row.asset_condition_date,
      lastScanDate: row.last_scan_date, lastScanCity: row.last_scan_city,
      assetCreatedBy: row.asset_created_by, assetGeoFenceStatus: row.asset_geo_fence_status,
      assigneeType: row.assignee_type, oldAssetNumber: row.old_asset_number,
      status: row.status, verificationDate: row.verification_date,
      verifiedBy: row.verified_by, assetImageUrl: row.asset_image_url,
      barcodeImageUrl: row.barcode_image_url,
      confidence: parseFloat(row.confidence) || 0,
      customFields: row.custom_fields || {}, tags: row.tags || [],
      createdAt: row.created_at,
    };
  },

  _assetToDb(asset) {
    return {
      name: asset.name, description: asset.description,
      name_confidence: asset.nameConfidence,
      description_confidence: asset.descriptionConfidence,
      category: asset.category, sub_category: asset.subCategory,
      asset_class: asset.assetClass, asset_type: asset.assetType,
      asset_criticality: asset.assetCriticality,
      category_confidence: asset.categoryConfidence,
      make: asset.make, model: asset.model,
      serial_number: asset.serialNumber, hsn_code: asset.hsnCode,
      barcode: asset.barcode, barcode_raw_data: asset.barcodeRawData,
      qr_code_data: asset.qrCodeData,
      purchase_price: asset.purchasePrice, cost_confidence: asset.costConfidence,
      cgst: asset.cgst, sgst: asset.sgst, igst: asset.igst,
      tax: asset.tax, total_cost: asset.totalCost,
      taxes_detail: asset.taxesDetail, taxes_confidence: asset.taxesConfidence,
      installation_charges: asset.installationCharges,
      installation_confidence: asset.installationConfidence,
      currency: asset.currency || 'INR',
      vendor: asset.vendor, invoice_number: asset.invoiceNumber,
      invoice_date: asset.invoiceDate, acquisition_date: asset.acquisitionDate,
      parent_asset_id: asset.parentAssetId || null,
      parent_asset_dummy_number: asset.parentAssetDummyNumber,
      asset_group_id: asset.assetGroupId,
      child_index: asset.childIndex, group_reason: asset.groupReason,
      is_parent_asset: asset.isParentAsset,
      is_parent_confidence: asset.isParentConfidence,
      unit_of_measure: asset.unitOfMeasure,
      bulk_quantity: asset.bulkQuantity, is_bulk_asset: asset.isBulkAsset,
      status: asset.status, assigned_to: asset.assignedTo,
      cost_center: asset.costCenter, plant_location: asset.plantLocation,
      location_id: asset.locationId || null,
      department_id: asset.departmentId || null,
      useful_life_years: asset.usefulLifeYears,
      depreciation_method: asset.depreciationMethod,
      depreciation_rate: asset.depreciationRate,
      salvage_value: asset.salvageValue,
      warranty_start_date: asset.warrantyStartDate,
      warranty_end_date: asset.warrantyEndDate,
      warranty_provider: asset.warrantyProvider,
      warranty_number: asset.warrantyNumber,
      amc_start_date: asset.amcStartDate, amc_end_date: asset.amcEndDate,
      amc_provider: asset.amcProvider, amc_cost: asset.amcCost,
      condition: asset.condition, condition_source: asset.conditionSource,
      condition_details: asset.conditionDetails,
      tracking_config: asset.trackingConfig,
      tracking_config_confidence: asset.trackingConfigConfidence,
      tracking_config_source: asset.trackingConfigSource,
      invoice_provenance: asset.invoiceProvenance,
      source: asset.source || 'invoice',
      po_number: asset.poNumber, po_date: asset.poDate,
      grn_number: asset.grnNumber, grn_date: asset.grnDate,
      pr_number: asset.prNumber, asset_nature: asset.assetNature,
      insurance_start_date: asset.insuranceStartDate, insurance_end_date: asset.insuranceEndDate,
      insurance_number: asset.insuranceNumber, insurance_vendor: asset.insuranceVendor,
      lease_start_date: asset.leaseStartDate, lease_end_date: asset.leaseEndDate,
      lease_cost: asset.leaseCost, lease_contract_number: asset.leaseContractNumber, lease_vendor: asset.leaseVendor,
      asset_expiry_date: asset.assetExpiryDate, nbv: asset.nbv, nbv_date: asset.nbvDate,
      put_to_use_date: asset.putToUseDate, residual_value: asset.residualValue,
      residual_value_percentage: asset.residualValuePercentage, installation_date: asset.installationDate,
      business_segment: asset.businessSegment, group_name: asset.groupName,
      legal_entity: asset.legalEntity, controlling_region: asset.controllingRegion,
      profit_center: asset.profitCenter, sub_location: asset.subLocation,
      last_scan_latitude: asset.lastScanLatitude, last_scan_longitude: asset.lastScanLongitude,
      location_radius: asset.locationRadius, allocated_to: asset.allocatedTo,
      asset_status_date: asset.assetStatusDate, asset_condition_date: asset.assetConditionDate,
      last_scan_date: asset.lastScanDate, last_scan_city: asset.lastScanCity,
      asset_created_by: asset.assetCreatedBy, asset_geo_fence_status: asset.assetGeoFenceStatus,
      assignee_type: asset.assigneeType, old_asset_number: asset.oldAssetNumber,
      verification_date: asset.verificationDate,
      verified_by: asset.verifiedBy,
      asset_image_url: asset.assetImageUrl,
      barcode_image_url: asset.barcodeImageUrl,
      confidence: asset.confidence,
      custom_fields: asset.customFields, tags: asset.tags,
    };
  },

  // ═══════════════════════════════════════════════════
  // UPDATE METHODS
  // ═══════════════════════════════════════════════════

  async updateAssetField(assetId, key, value) {
    const asset = _cache.assets.find(a => a.id === assetId);
    if (!asset) return;
    asset[key] = value;
    const dbPayload = this._assetToDb(asset);
    try {
      await Supabase.update('assets', assetId, dbPayload);
      console.log(`[STORAGE] Updated field ${key} for asset ${assetId}`);
    } catch (e) { console.error(`[STORAGE] Update field error:`, e); }
  },

  async updateAssetCustomField(assetId, key, value) {
    const asset = _cache.assets.find(a => a.id === assetId);
    if (!asset) return;
    if (!asset.customFields) asset.customFields = {};
    asset.customFields[key] = value;
    try {
      await Supabase.update('assets', assetId, { custom_fields: asset.customFields });
      console.log(`[STORAGE] Updated custom field ${key} for asset ${assetId}`);
    } catch (e) { console.error(`[STORAGE] Update custom field error:`, e); }
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
      await Supabase.deleteWhere('asset_enrichments');
      await Supabase.deleteWhere('asset_identifications');
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
