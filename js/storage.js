/**
 * Assetcues — Supabase + localStorage hybrid storage layer.
 * Supabase is the source of truth; localStorage is a read cache.
 * All writes go to Supabase first, then cache locally.
 */

const ORG_ID = DEFAULT_ORG_ID;

// Normalize any date string to ISO YYYY-MM-DD for PostgreSQL
function _normalizeDate(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  // Already ISO: 2025-05-15
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY or MM/DD/YYYY — disambiguate
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    let day = parseInt(m[1]), month = parseInt(m[2]);
    // If second number > 12, it can't be a month → first is month (MM/DD/YYYY)
    if (month > 12 && day <= 12) {
      [day, month] = [month, day];
    }
    // If both <= 12, default DD/MM (Indian locale)
    // Validate
    if (month < 1 || month > 12 || day < 1) return null;
    const daysInMonth = new Date(parseInt(m[3]), month, 0).getDate();
    if (day > daysInMonth) return null;
    return `${m[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  // Fallback — try Date.parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

// Helper to unwrap ConfidenceField objects: {value: x, confidence: y} → x
function _unwrap(v) {
  if (v && typeof v === 'object' && 'value' in v) return v.value;
  return v;
}

// Local cache helpers
function _cacheGet(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function _cacheSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { /* quota */ }
}

const Storage = {

  // ─── SETTINGS ──────────────────────────────────────
  getSettings() {
    return _cacheGet('ac_settings') || { apiUrl: 'https://assetcues-backend.onrender.com', tenantId: 'poc' };
  },
  saveSettings(s) { _cacheSet('ac_settings', s); },

  // ─── EXTRACTIONS ───────────────────────────────────
  // Cache key for extractions list
  _extractionsCache: null,

  async fetchExtractions() {
    const data = await Supabase.query('extractions', {
      order: 'created_at.desc',
      filters: { org_id: ORG_ID }
    });
    // Normalize to frontend format
    const normalized = (data || []).map(e => this._dbToExtraction(e));
    _cacheSet('ac_extractions', normalized);
    this._extractionsCache = normalized;
    return normalized;
  },

  getExtractions() {
    if (this._extractionsCache) return this._extractionsCache;
    return _cacheGet('ac_extractions') || [];
  },

  getExtraction(id) {
    return this.getExtractions().find(e => e.id === id) || null;
  },

  // Async version: tries cache first, then fetches from Supabase directly
  async getExtractionAsync(id) {
    let ext = this.getExtraction(id);
    if (ext) return ext;
    // Fallback: fetch directly from Supabase
    console.log('[STORAGE] Cache miss for extraction', id, '— fetching from Supabase...');
    const row = await Supabase.query('extractions', { filters: { id: id }, single: true });
    if (!row) return null;
    ext = this._dbToExtraction(row);
    // Also populate assetIds
    const linkedAssets = await Supabase.query('assets', { filters: { extraction_id: id } });
    ext.assetIds = (linkedAssets || []).map(a => a.id);
    return ext;
  },

  async saveExtraction(data) {
    const dbData = this._extractionToDb(data);
    dbData.id = data.id;
    dbData.org_id = ORG_ID;
    const result = await Supabase.upsert('extractions', dbData);
    // Update local cache
    const list = this.getExtractions();
    const idx = list.findIndex(e => e.id === data.id);
    if (idx >= 0) list[idx] = data;
    else list.unshift(data);
    _cacheSet('ac_extractions', list);
    this._extractionsCache = list;
    return data;
  },

  async createExtraction(fileName, extractionJson, confidence, pageCount) {
    console.log('%c[STORAGE] 📥 createExtraction starting...', 'color:#009668;font-weight:bold');
    console.log('[STORAGE]    File:', fileName, '| Confidence:', (confidence * 100).toFixed(1) + '%');

    const vendorName = (extractionJson?.vendor_details?.vendor_name?.value || extractionJson?.vendor_details?.vendor_name) || 'Unknown';
    const invoiceNumber = (extractionJson?.invoice_header?.invoice_number?.value || extractionJson?.invoice_header?.invoice_number) || '';
    const invoiceDateRaw = (extractionJson?.invoice_header?.invoice_date?.value || extractionJson?.invoice_header?.invoice_date) || null;
    const invoiceDate = _normalizeDate(invoiceDateRaw);
    const grandTotal = extractionJson?.totals?.grand_total?.value ?? extractionJson?.totals?.grand_total ?? 0;

    console.log('[STORAGE]    Vendor:', vendorName, '| Invoice:', invoiceNumber, '| Date raw:', invoiceDateRaw, '→ normalized:', invoiceDate);
    console.log('[STORAGE]    Grand Total: ₹' + Number(grandTotal).toLocaleString('en-IN'));

    // Check for duplicate invoice
    const duplicateAlert = await this._checkDuplicateInvoice(invoiceNumber, vendorName);
    if (duplicateAlert) console.warn('[STORAGE]    ⚠️  Potential duplicate invoice detected!');

    const dbRow = {
      org_id: ORG_ID,
      file_name: fileName,
      status: 'draft',
      extraction_json: extractionJson,
      vendor_name: vendorName,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate || null,
      grand_total: grandTotal,
      confidence: confidence || 0,
    };

    console.log('[STORAGE]    → Inserting into extractions table...');
    const result = await Supabase.insert('extractions', dbRow);
    if (!result) {
      console.error('[STORAGE]    ❌ INSERT FAILED! Supabase returned null.');
      throw new Error('Failed to create extraction in Supabase — check console for Supabase insert errors above');
    }
    console.log('[STORAGE]    ✅ Extraction inserted, ID:', result.id);

    const extraction = this._dbToExtraction(result);

    // Audit
    await this.addAuditEntry(extraction.id, null, 'ai_extracted', `AI extracted ${fileName} with ${Math.round(confidence*100)}% confidence`);

    // Auto-create assets (status: in_review — will be promoted to 'verified' on approval or deleted on rejection)
    console.log('[STORAGE]    → Expanding line items into assets...');
    const assets = await this._expandAssets(extraction);
    console.log(`[STORAGE]    ✅ ${assets.length} asset(s) created (status: in_review)`);
    extraction.assetIds = assets.map(a => a.id);
    await this.saveExtraction(extraction);

    // Duplicate alert
    if (duplicateAlert) {
      await Supabase.insert('anomaly_alerts', {
        org_id: ORG_ID,
        alert_type: 'duplicate_invoice',
        severity: 'high',
        title: `Possible duplicate: Invoice #${invoiceNumber}`,
        description: `Invoice #${invoiceNumber} from ${vendorName} may already exist in the system.`,
        related_extraction_id: extraction.id,
      });
    }

    console.log('%c[STORAGE] ✅ createExtraction complete', 'color:#009668;font-weight:bold');
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

    // Query assets directly from DB by extraction_id (don't trust cache)
    const linkedAssets = await Supabase.query('assets', {
      select: 'id,asset_number',
      filters: { extraction_id: id },
    }) || [];

    // Update all linked assets: set verified + generate barcode/QR data
    for (const row of linkedAssets) {
      const qrUrl = `${baseUrl}asset-detail.html?id=${row.id}`;
      await Supabase.update('assets', row.id, {
        status: 'verified',
        verification_date: now,
        barcode: row.asset_number,
        qr_code_data: qrUrl,
      });
    }

    // Link ONE invoice entry to all approved assets (no duplication)
    const invoiceNumber = ext.invoiceNumber || '';
    const invoiceDate = ext.invoiceDate || null;
    const grandTotal = ext.grandTotal || 0;
    if (invoiceNumber && linkedAssets.length > 0) {
      const invoiceRows = linkedAssets.map(row => ({
        asset_id: row.id,
        extraction_id: id,
        invoice_type: 'purchase',
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        amount: grandTotal,
        description: `Auto-linked from extraction: ${ext.fileName || ''}`,
      }));
      await Supabase.insert('asset_invoices', invoiceRows);
    }

    // Update local assetIds cache
    ext.assetIds = linkedAssets.map(r => r.id);

    await this.addAuditEntry(id, null, 'approved', 'Extraction approved by user');
    await this.fetchAssets(); // refresh cache
  },

  async rejectExtraction(id) {
    console.log('%c[STORAGE] 🚫 Rejecting extraction:', 'color:#ba1a1a;font-weight:bold', id);
    const ext = this.getExtraction(id);
    if (!ext) return;

    // Record audit BEFORE deletion for compliance
    // Use null extraction_id so this entry survives the FK cleanup that follows
    await Supabase.insert('audit_trail', {
      extraction_id: null,
      asset_id: null,
      action: 'rejected',
      notes: `Extraction ${ext.fileName || ''} (Invoice #${ext.invoiceNumber || ''}, ID: ${id}) rejected by user. ${(ext.assetIds || []).length} assets removed.`,
      performed_by: 'user',
      created_at: new Date().toISOString(),
    });

    // Bulk delete all linked data via DB function (single call, FK-safe)
    console.log(`[STORAGE]    🗑️  Deleting extraction + all linked data...`);
    let rpcResult = null;
    try { rpcResult = await Supabase.rpc('delete_extraction_cascade', { p_extraction_id: id }); } catch(e) { console.warn('RPC failed:', e); }
    if (!rpcResult) {
      // RPC not available — fallback to sequential deletes
      console.warn('[STORAGE]    RPC unavailable, using fallback...');
      await Supabase.deleteWhere('asset_invoices', { extraction_id: id });
      await Supabase.deleteWhere('anomaly_alerts', { related_extraction_id: id });
      await Supabase.deleteWhere('audit_trail', { extraction_id: id });
      // Delete asset child records
      const linkedAssets = await Supabase.query('assets', { select: 'id', filters: { extraction_id: id } }) || [];
      for (const row of linkedAssets) {
        await Supabase.deleteWhere('asset_invoices', { asset_id: row.id });
        await Supabase.deleteWhere('audit_trail', { asset_id: row.id });
        await Supabase.deleteWhere('depreciation_entries', { asset_id: row.id });
        await Supabase.deleteWhere('physical_audits', { asset_id: row.id });
      }
      await Supabase.deleteWhere('assets', { extraction_id: id });
      await Supabase.deleteWhere('audit_trail', { extraction_id: id });
      await Supabase.delete('extractions', id);
    }
    console.log('%c[STORAGE]    ✅ Extraction deleted', 'color:#ba1a1a;font-weight:bold');

    // Remove from local cache
    const list = this.getExtractions();
    const idx = list.findIndex(e => e.id === id);
    if (idx >= 0) list.splice(idx, 1);
    _cacheSet('ac_extractions', list);
    this._extractionsCache = list;

    // Refresh assets cache
    await this.fetchAssets();
    console.log('%c[STORAGE] ✅ Rejection complete — all data cleaned up', 'color:#ba1a1a;font-weight:bold');
  },

  // ─── ASSETS ────────────────────────────────────────
  _assetsCache: null,

  async fetchAssets() {
    const data = await Supabase.query('assets', {
      order: 'created_at.desc',
      filters: { org_id: ORG_ID }
    });
    const normalized = (data || []).map(a => this._dbToAsset(a));
    _cacheSet('ac_assets', normalized);
    this._assetsCache = normalized;
    return normalized;
  },

  getAssets() {
    if (this._assetsCache) return this._assetsCache;
    return _cacheGet('ac_assets') || [];
  },

  getAsset(id) {
    return this.getAssets().find(a => a.id === id) || null;
  },

  async getAssetAsync(id) {
    let asset = this.getAsset(id);
    if (asset) return asset;
    console.log('[STORAGE] Cache miss for asset', id, '— fetching from Supabase...');
    const row = await Supabase.query('assets', { filters: { id: id }, single: true });
    if (!row) return null;
    return this._dbToAsset(row);
  },

  async saveAsset(data) {
    const dbData = this._assetToDb(data);
    await Supabase.update('assets', data.id, dbData);
    // Update cache
    const list = this.getAssets();
    const idx = list.findIndex(a => a.id === data.id);
    if (idx >= 0) list[idx] = data;
    else list.unshift(data);
    _cacheSet('ac_assets', list);
    this._assetsCache = list;
    return data;
  },

  async _getNextAssetNumber() {
    const result = await Supabase.query('assets', {
      select: 'asset_number',
      filters: { org_id: ORG_ID },
      order: 'created_at.desc',
      limit: 50
    });
    if (result && result.length > 0) {
      let maxNum = 1000;
      for (const r of result) {
        // Only match main asset numbers (AST-1001), not children (AST-1001-001)
        const m = (r.asset_number || '').match(/^AST-(\d+)$/);
        if (m) {
          const num = parseInt(m[1]);
          if (num > maxNum) maxNum = num;
        }
      }
      return maxNum + 1;
    }
    return 1001;
  },

  _parseSerialNumbers(json) {
    const serials = [];
    const atc = json.assets_to_create || [];
    atc.forEach(a => { if (a.serial_number) serials.push(a.serial_number); });
    if (serials.length > 0) return serials;
    (json.line_items || []).forEach(li => {
      if (li.serial_numbers_listed && Array.isArray(li.serial_numbers_listed)) {
        li.serial_numbers_listed.forEach(s => serials.push(s));
      }
    });
    return serials;
  },

  async _expandAssets(extraction) {
    const json = extraction.extractionJson;
    if (!json) return [];

    const assets = [];
    let nextNum = await this._getNextAssetNumber();
    const serialNumbers = this._parseSerialNumbers(json);
    const vendor = (json.vendor_details?.vendor_name?.value || json.vendor_details?.vendor_name) || 'Unknown';
    const invoiceNumber = (json.invoice_header?.invoice_number?.value || json.invoice_header?.invoice_number) || '';
    const invoiceDateRaw = (json.invoice_header?.invoice_date?.value || json.invoice_header?.invoice_date) || '';
    const invoiceDate = _normalizeDate(invoiceDateRaw);
    const totals = json.totals || {};
    const totalCgst = totals.total_cgst?.value ?? totals.total_cgst ?? 0;
    const totalSgst = totals.total_sgst?.value ?? totals.total_sgst ?? 0;
    const totalIgst = totals.total_igst?.value ?? totals.total_igst ?? 0;
    const subtotal = totals.subtotal_before_tax?.value ?? totals.subtotal_before_tax ?? 0;

    const BULK_UNITS = ['kg','kgs','g','gm','gram','grams','l','ltr','litre','litres','liter','liters','ml','mt','ton','tons','tonne','tonnes','quintal','qtl','mtr','meter','meters','metre','ft','feet','sqft','mm','cm','inch','inches'];

    const tempIdMap = {};
    const assetRows = []; // Collect all for bulk insert

    const atc = json.assets_to_create || [];
    if (atc.length >= 1) {
      atc.forEach((a, i) => {
        const assetNum = nextNum++;
        const assetNumber = `AST-${String(assetNum).padStart(4,'0')}`;
        const row = {
          org_id: ORG_ID,
          extraction_id: extraction.id,
          asset_number: assetNumber,
          name: a.asset_name || a.description || `Asset ${i+1}`,
          category: a.suggested_category || 'IT Equipment',
          sub_category: a.suggested_sub_category || null,
          asset_class: a.suggested_asset_class || null,
          make: a.suggested_make || null,
          model: a.suggested_model || null,
          serial_number: a.serial_number || serialNumbers[i] || null,
          purchase_price: a.individual_cost_before_tax || a.individual_cost_with_tax || 0,
          cgst: a.individual_cgst || 0,
          sgst: a.individual_sgst || 0,
          igst: a.individual_igst || 0,
          tax: a.individual_tax || 0,
          total_cost: a.individual_cost_with_tax || a.individual_cost_before_tax || 0,
          vendor: vendor,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate || null,
          status: 'in_review',
          hsn_code: a.hsn_sac_code || null,
          acquisition_date: invoiceDate || new Date().toISOString().split('T')[0],
          confidence: a.confidence_overall || extraction.confidence || 0,
          unit_of_measure: a.unit_of_measure || 'Nos',
          bulk_quantity: a.bulk_quantity || null,
          is_bulk_asset: a.is_bulk_asset || false,
          custom_fields: {},
          _backend_temp_id: a.temp_asset_id,
          _group_action: a.group_action || 'none',
          _group_parent_temp_id: a.group_parent_temp_id || null,
          _group_reason: a.group_reason || null,
        };
        assetRows.push(row);
      });
    } else {
      const lineItems = json.line_items || [];
      lineItems.forEach((li, liIdx) => {
        const rawQty = _unwrap(li.quantity) || 1;
        const unitRaw = (_unwrap(li.unit) || 'Nos');
        const unitNorm = unitRaw.toLowerCase().trim().replace(/\.$/, '');
        const isBulk = BULK_UNITS.includes(unitNorm);
        const expandQty = isBulk ? 1 : rawQty;
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
          const serial = serialNumbers[assets.length + assetRows.length] || null;
          const tempId = `tmp_ast_${String(assetRows.length + 1).padStart(3, '0')}`;
          assetRows.push({
            org_id: ORG_ID,
            extraction_id: extraction.id,
            asset_number: assetNumber,
            name: desc,
            category: 'IT Equipment',
            serial_number: serial,
            purchase_price: Math.round(unitPrice * 100) / 100,
            cgst: Math.round(unitCgst * 100) / 100,
            sgst: Math.round(unitSgst * 100) / 100,
            igst: Math.round(unitIgst * 100) / 100,
            tax: Math.round(unitTax * 100) / 100,
            total_cost: Math.round(unitTotal * 100) / 100,
            vendor, invoice_number: invoiceNumber, invoice_date: invoiceDate || null,
            hsn_code: hsnCode || null,
            status: 'in_review',
            acquisition_date: invoiceDate || new Date().toISOString().split('T')[0],
            confidence: extraction.confidence || 0,
            unit_of_measure: unitRaw,
            bulk_quantity: bulkQuantity,
            is_bulk_asset: isBulk,
            custom_fields: {},
            _backend_temp_id: tempId,
            _group_action: li.group_action || 'none',
            _group_parent_temp_id: li.group_parent_temp_id || null,
            _group_reason: li.group_reason || null,
          });
        }
      });
    }

    // If assets have ₹0 tax but invoice has tax, distribute evenly
    const assetTaxSum = assetRows.reduce((s, r) => s + (r.cgst || 0) + (r.sgst || 0) + (r.igst || 0), 0);
    if (assetTaxSum === 0 && (totalCgst || totalSgst || totalIgst) && assetRows.length > 0) {
      const n = assetRows.length;
      const perCgst = Math.round((totalCgst / n) * 100) / 100;
      const perSgst = Math.round((totalSgst / n) * 100) / 100;
      const perIgst = Math.round((totalIgst / n) * 100) / 100;
      const perTax = perCgst + perSgst + perIgst;
      assetRows.forEach(r => {
        r.cgst = perCgst;
        r.sgst = perSgst;
        r.igst = perIgst;
        r.tax = perTax;
        r.total_cost = Math.round(((r.purchase_price || 0) + perTax) * 100) / 100;
      });
    }

    // Clean transient fields before insert and store them separately
    const groupInfo = assetRows.map(r => ({
      tempId: r._backend_temp_id,
      action: r._group_action,
      parentTempId: r._group_parent_temp_id,
      reason: r._group_reason,
    }));
    assetRows.forEach(r => {
      delete r._backend_temp_id;
      delete r._group_action;
      delete r._group_parent_temp_id;
      delete r._group_reason;
    });

    // Bulk insert all assets
    const inserted = await Supabase.insert('assets', assetRows);
    if (!inserted || inserted.length === 0) return [];

    // Build tempId → inserted asset map
    const insertedAssets = Array.isArray(inserted) ? inserted : [inserted];
    insertedAssets.forEach((dbAsset, i) => {
      const info = groupInfo[i];
      if (info?.tempId) tempIdMap[info.tempId] = dbAsset;
    });

    // Resolve parent-child relationships
    const childCounters = {};
    for (let i = 0; i < insertedAssets.length; i++) {
      const info = groupInfo[i];
      const dbAsset = insertedAssets[i];
      if (info.action === 'suggest_group_with_parent' && info.parentTempId) {
        const parentDb = tempIdMap[info.parentTempId];
        if (parentDb) {
          const parentNum = parentDb.asset_number;
          if (!childCounters[parentNum]) childCounters[parentNum] = 1;
          const childIdx = childCounters[parentNum]++;
          const childAssetNumber = `${parentNum}-${String(childIdx).padStart(3,'0')}`;
          await Supabase.update('assets', dbAsset.id, {
            parent_asset_id: parentDb.id,
            child_index: childIdx,
            group_reason: info.reason,
            asset_number: childAssetNumber,
          });
        }
      }
    }

    // Auto-apply vendor custom fields
    const vendorProfile = await this.matchVendorProfile(vendor);
    if (vendorProfile) {
      for (const dbAsset of insertedAssets) {
        const cf = {};
        (vendorProfile.custom_fields || []).forEach(f => {
          cf[f.key] = { label: f.label, value: f.defaultValue || '', type: f.type || 'text' };
        });
        await Supabase.update('assets', dbAsset.id, { custom_fields: cf });
      }
    }

    // Audit
    if (insertedAssets.length > 0) {
      await this.addAuditEntry(extraction.id, null, 'assets_created',
        `Created ${insertedAssets.length} assets from ${extraction.fileName}`);
    }

    // Refresh cache
    await this.fetchAssets();
    return this.getAssets().filter(a => a.extractionId === extraction.id);
  },

  // ─── AUDIT TRAIL ───────────────────────────────────
  async addAuditEntry(extractionId, assetId, action, details) {
    await Supabase.insert('audit_trail', {
      extraction_id: extractionId || null,
      asset_id: assetId || null,
      action,
      notes: details,
      performed_by: 'user',
      created_at: new Date().toISOString(),
    });
  },

  async getAuditLog(entityId) {
    if (!entityId) return [];
    // Try both extraction_id and asset_id
    const byExt = await Supabase.query('audit_trail', {
      filters: { extraction_id: entityId },
      order: 'created_at.desc'
    });
    const byAsset = await Supabase.query('audit_trail', {
      filters: { asset_id: entityId },
      order: 'created_at.desc'
    });
    return [...(byExt || []), ...(byAsset || [])].map(e => ({
      id: e.id,
      timestamp: e.created_at,
      entityId: e.extraction_id || e.asset_id,
      entityType: e.extraction_id ? 'extraction' : 'asset',
      action: e.action,
      details: e.notes,
    }));
  },

  // ─── ASSET FIELD UPDATE ────────────────────────────
  async updateAssetField(assetId, field, value) {
    const asset = this.getAsset(assetId);
    if (!asset) return null;
    const old = asset[field];
    asset[field] = value;

    // Map frontend field to DB column
    const fieldMap = {
      name: 'name', category: 'category', subCategory: 'sub_category',
      serialNumber: 'serial_number', hsnCode: 'hsn_code', make: 'make', model: 'model',
      purchasePrice: 'purchase_price', cgst: 'cgst', sgst: 'sgst', igst: 'igst',
      tax: 'tax', totalCost: 'total_cost', status: 'status',
      assignedTo: 'assigned_to', costCenter: 'cost_center',
    };
    const dbField = fieldMap[field] || field;
    await Supabase.update('assets', assetId, { [dbField]: value });

    // Update cache
    const list = this.getAssets();
    const idx = list.findIndex(a => a.id === assetId);
    if (idx >= 0) list[idx] = asset;
    _cacheSet('ac_assets', list);
    this._assetsCache = list;

    await this.addAuditEntry(null, assetId, 'field_edited', `${field}: "${old}" → "${value}"`);
    return asset;
  },

  // ─── VENDOR PROFILES ──────────────────────────────
  _vendorCache: null,

  async fetchVendorProfiles() {
    const data = await Supabase.query('vendor_profiles', {
      filters: { org_id: ORG_ID },
      order: 'created_at.desc'
    });
    this._vendorCache = data || [];
    _cacheSet('ac_vendor_profiles', this._vendorCache);
    return this._vendorCache;
  },

  getVendorProfiles() {
    if (this._vendorCache) return this._vendorCache;
    return _cacheGet('ac_vendor_profiles') || [];
  },

  getVendorProfile(id) {
    return this.getVendorProfiles().find(v => v.id === id) || null;
  },

  async saveVendorProfile(profile) {
    if (profile.id) {
      await Supabase.update('vendor_profiles', profile.id, profile);
    } else {
      profile.org_id = ORG_ID;
      const result = await Supabase.insert('vendor_profiles', profile);
      if (result) profile.id = result.id;
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
    let match = profiles.find(p => {
      const pn = (p.vendor_name || '').toLowerCase().trim();
      return pn && pn === normalized;
    });
    if (!match) {
      match = profiles.find(p => {
        const pn = (p.vendor_name || '').toLowerCase().trim();
        return pn && (normalized.includes(pn) || pn.includes(normalized));
      });
    }
    return match || null;
  },

  // ─── TEMPLATES ─────────────────────────────────────
  // fetchTemplates is defined later with try/catch for resilience

  getTemplates() {
    return _cacheGet('ac_templates') || [];
  },

  // ─── ANOMALY ALERTS ────────────────────────────────
  async fetchAlerts() {
    const data = await Supabase.query('anomaly_alerts', {
      filters: { org_id: ORG_ID, is_resolved: false },
      order: 'created_at.desc'
    });
    return data || [];
  },

  async resolveAlert(alertId) {
    await Supabase.update('anomaly_alerts', alertId, {
      is_resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: 'user'
    });
  },

  // ─── DUPLICATE DETECTION ──────────────────────────
  async _checkDuplicateInvoice(invoiceNumber, vendorName) {
    if (!invoiceNumber) return false;
    const filters = {
      invoice_number: invoiceNumber,
      org_id: ORG_ID
    };
    if (vendorName) filters.vendor_name = vendorName;
    const existing = await Supabase.query('extractions', { filters });
    return existing && existing.length > 0;
  },

  async checkDuplicateSerial(serialNumber) {
    if (!serialNumber) return null;
    const existing = await Supabase.query('assets', {
      select: 'id,asset_number,name,serial_number',
      filters: {
        serial_number: serialNumber,
        org_id: ORG_ID
      }
    });
    return existing && existing.length > 0 ? existing[0] : null;
  },

  // ─── DEPRECIATION ─────────────────────────────────
  async calculateDepreciation(assetId) {
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

    // Calculate for each fiscal year (April-March in India)
    let fy_start_year = acqDate.getMonth() >= 3 ? acqDate.getFullYear() : acqDate.getFullYear() - 1;

    for (let yr = 0; yr < Math.ceil(life) + 1; yr++) {
      if (openingValue <= salvage) break;

      const fyLabel = `FY ${fy_start_year + yr}-${String(fy_start_year + yr + 1).slice(-2)}`;

      // Days used in first year (pro-rata)
      let daysUsed = 365;
      if (yr === 0) {
        const fyEnd = new Date(fy_start_year + 1, 2, 31); // March 31
        const diffMs = fyEnd - acqDate;
        daysUsed = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        if (daysUsed > 365) daysUsed = 365;
      }

      let depAmount;
      if (method === 'WDV') {
        depAmount = openingValue * (rate / 100) * (daysUsed / 365);
      } else {
        depAmount = ((cost - salvage) / life) * (daysUsed / 365);
      }

      depAmount = Math.round(depAmount * 100) / 100;
      const closingValue = Math.max(Math.round((openingValue - depAmount) * 100) / 100, salvage);
      depAmount = Math.round((openingValue - closingValue) * 100) / 100;

      schedule.push({
        fiscal_year: fyLabel,
        opening_value: openingValue,
        depreciation_amount: depAmount,
        closing_value: closingValue,
        method,
        rate,
        days_used: daysUsed,
      });

      openingValue = closingValue;
    }

    return schedule;
  },

  async saveDepreciationSchedule(assetId, schedule) {
    // Delete existing entries for this asset
    const existing = await Supabase.query('depreciation_entries', {
      filters: { asset_id: assetId }
    });
    for (const e of (existing || [])) {
      await Supabase.delete('depreciation_entries', e.id);
    }
    // Insert new schedule
    const rows = schedule.map(s => ({
      asset_id: assetId,
      ...s
    }));
    if (rows.length > 0) {
      await Supabase.insert('depreciation_entries', rows);
    }
    return schedule;
  },

  // ─── PHYSICAL AUDITS ──────────────────────────────
  async recordPhysicalAudit(assetId, { method, condition, notes, location, photoUrl, lat, lng }) {
    return await Supabase.insert('physical_audits', {
      asset_id: assetId,
      audited_by: 'user',
      audit_method: method || 'manual',
      condition: condition || 'good',
      notes,
      location_verified: location,
      photo_url: photoUrl,
      gps_lat: lat,
      gps_lng: lng,
    });
  },

  async getPhysicalAudits(assetId) {
    return await Supabase.query('physical_audits', {
      filters: { asset_id: assetId },
      order: 'scanned_at.desc'
    });
  },

  // ─── MULTI-INVOICE LINKING ─────────────────────────
  async linkInvoice(assetId, data) {
    // Accept either camelCase or snake_case keys
    return await Supabase.insert('asset_invoices', {
      asset_id: assetId,
      invoice_type: data.invoice_type || data.invoiceType || 'purchase',
      invoice_number: data.invoice_number || data.invoiceNumber,
      invoice_date: data.invoice_date || data.invoiceDate,
      amount: data.amount,
      description: data.description,
      file_url: data.file_url || data.fileUrl,
    });
  },

  async getLinkedInvoices(assetId) {
    return await Supabase.query('asset_invoices', {
      filters: { asset_id: assetId },
      order: 'created_at.desc'
    });
  },

  // ─── LOCATIONS & DEPARTMENTS ───────────────────────
  async fetchLocations() {
    const data = await Supabase.query('locations', { filters: { org_id: ORG_ID } });
    _cacheSet('ac_locations', data);
    return data || [];
  },
  getLocations() { return _cacheGet('ac_locations') || []; },

  async saveLocation(loc) {
    loc.org_id = ORG_ID;
    if (loc.id) return await Supabase.update('locations', loc.id, loc);
    return await Supabase.insert('locations', loc);
  },

  async fetchDepartments() {
    const data = await Supabase.query('departments', { filters: { org_id: ORG_ID } });
    _cacheSet('ac_departments', data);
    return data || [];
  },
  getDepartments() { return _cacheGet('ac_departments') || []; },

  async saveDepartment(dept) {
    dept.org_id = ORG_ID;
    if (dept.id) return await Supabase.update('departments', dept.id, dept);
    return await Supabase.insert('departments', dept);
  },

  // ─── TEMPLATES ─────────────────────────────────────
  async fetchTemplates() {
    try {
      const data = await Supabase.query('asset_templates', {
        filters: { org_id: ORG_ID },
        order: 'category.asc,name.asc'
      });
      return data || [];
    } catch(e) {
      console.warn('Templates table not found, using fallback');
      return [];
    }
  },

  // ─── DASHBOARD STATS ──────────────────────────────
  getDashboardStats() {
    const assets = this.getAssets();
    const extractions = this.getExtractions();
    const totalValue = assets.reduce((sum, a) => sum + (a.totalCost || 0), 0);
    const totalTax = assets.reduce((sum, a) => sum + (a.tax || 0), 0);
    const pending = extractions.filter(e => e.status === 'draft').length;
    const approved = extractions.filter(e => e.status === 'approved').length;
    const warrantyExpiring = assets.filter(a => {
      if (!a.warrantyEndDate) return false;
      const diff = new Date(a.warrantyEndDate) - new Date();
      return diff > 0 && diff < 90 * 24 * 60 * 60 * 1000;
    }).length;
    return { totalValue, totalTax, pending, approved, totalAssets: assets.length, totalExtractions: extractions.length, warrantyExpiring };
  },

  // ─── DATA CONVERSION: DB ↔ Frontend ────────────────
  _dbToExtraction(row) {
    return {
      id: row.id,
      fileName: row.file_name,
      timestamp: row.created_at,
      status: row.status,
      confidence: parseFloat(row.confidence) || 0,
      extractionJson: row.extraction_json,
      vendorName: row.vendor_name,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      grandTotal: parseFloat(row.grand_total) || 0,
      assetIds: [],  // Will be populated when assets are loaded
      approvedAt: row.updated_at,
      duplicateOf: row.duplicate_of,
    };
  },

  _extractionToDb(ext) {
    return {
      file_name: ext.fileName,
      status: ext.status,
      confidence: ext.confidence,
      extraction_json: ext.extractionJson,
      vendor_name: ext.vendorName || (ext.extractionJson?.vendor_details?.vendor_name?.value),
      invoice_number: ext.invoiceNumber || (ext.extractionJson?.invoice_header?.invoice_number?.value),
      invoice_date: ext.invoiceDate || null,
      grand_total: ext.grandTotal || 0,
    };
  },

  _dbToAsset(row) {
    // Resolve parent asset number from cache if available
    let parentAssetNumber = null;
    if (row.parent_asset_id) {
      const cached = this._assetsCache || _cacheGet('ac_assets') || [];
      const parent = cached.find(a => a.id === row.parent_asset_id);
      parentAssetNumber = parent ? (parent.assetNumber || parseInt((parent.tempAssetId || '').replace(/\D/g, '')) || 0) : 0;
    }
    return {
      id: row.id,
      extractionId: row.extraction_id,
      assetNumber: parseInt((row.asset_number || '').replace(/\D/g, '')) || 0,
      tempAssetId: row.asset_number,
      name: row.name,
      description: row.description,
      category: row.category,
      subCategory: row.sub_category,
      assetClass: row.asset_class,
      make: row.make,
      model: row.model,
      serialNumber: row.serial_number,
      barcode: row.barcode,
      qrCodeData: row.qr_code_data,
      hsnCode: row.hsn_code,
      purchasePrice: parseFloat(row.purchase_price) || 0,
      cgst: parseFloat(row.cgst) || 0,
      sgst: parseFloat(row.sgst) || 0,
      igst: parseFloat(row.igst) || 0,
      tax: parseFloat(row.tax) || 0,
      totalCost: parseFloat(row.total_cost) || 0,
      vendor: row.vendor,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      acquisitionDate: row.acquisition_date,
      parentAssetId: row.parent_asset_id,
      parentAssetNumber,
      childIndex: row.child_index,
      groupReason: row.group_reason,
      unitOfMeasure: row.unit_of_measure || 'Nos',
      bulkQuantity: row.bulk_quantity ? parseFloat(row.bulk_quantity) : null,
      isBulkAsset: row.is_bulk_asset || false,
      locationId: row.location_id,
      departmentId: row.department_id,
      assignedTo: row.assigned_to,
      costCenter: row.cost_center,
      usefulLifeYears: row.useful_life_years ? parseFloat(row.useful_life_years) : null,
      depreciationMethod: row.depreciation_method || 'SLM',
      depreciationRate: row.depreciation_rate ? parseFloat(row.depreciation_rate) : null,
      salvageValue: row.salvage_value ? parseFloat(row.salvage_value) : 1,
      warrantyStartDate: row.warranty_start_date,
      warrantyEndDate: row.warranty_end_date,
      warrantyProvider: row.warranty_provider,
      amcStartDate: row.amc_start_date,
      amcEndDate: row.amc_end_date,
      amcProvider: row.amc_provider,
      amcCost: row.amc_cost ? parseFloat(row.amc_cost) : null,
      status: row.status,
      verificationDate: row.verification_date,
      verifiedBy: row.verified_by,
      assetImageUrl: row.asset_image_url,
      confidence: parseFloat(row.confidence) || 0,
      customFields: row.custom_fields || {},
      tags: row.tags || [],
      createdAt: row.created_at,
    };
  },

  _assetToDb(asset) {
    return {
      name: asset.name,
      category: asset.category,
      sub_category: asset.subCategory,
      asset_class: asset.assetClass,
      make: asset.make,
      model: asset.model,
      serial_number: asset.serialNumber,
      hsn_code: asset.hsnCode,
      purchase_price: asset.purchasePrice,
      cgst: asset.cgst, sgst: asset.sgst, igst: asset.igst,
      tax: asset.tax, total_cost: asset.totalCost,
      status: asset.status,
      assigned_to: asset.assignedTo,
      cost_center: asset.costCenter,
      useful_life_years: asset.usefulLifeYears,
      depreciation_method: asset.depreciationMethod,
      depreciation_rate: asset.depreciationRate,
      salvage_value: asset.salvageValue,
      warranty_start_date: asset.warrantyStartDate,
      warranty_end_date: asset.warrantyEndDate,
      warranty_provider: asset.warrantyProvider,
      amc_start_date: asset.amcStartDate,
      amc_end_date: asset.amcEndDate,
      amc_provider: asset.amcProvider,
      amc_cost: asset.amcCost,
      custom_fields: asset.customFields,
      tags: asset.tags,
      asset_image_url: asset.assetImageUrl,
    };
  },

  // ─── INITIALIZATION ────────────────────────────────
  async init() {
    console.log('🔄 Initializing Storage from Supabase...');
    try {
      await Promise.all([
        this.fetchExtractions().catch(e => console.warn('[STORAGE] ⚠️ Failed to fetch extractions:', e)),
        this.fetchAssets().catch(e => console.warn('[STORAGE] ⚠️ Failed to fetch assets:', e)),
        this.fetchVendorProfiles().catch(e => console.warn('[STORAGE] ⚠️ Failed to fetch vendors:', e)),
        this.fetchTemplates().catch(e => console.warn('[STORAGE] ⚠️ Failed to fetch templates:', e)),
        this.fetchLocations().catch(e => console.warn('[STORAGE] ⚠️ Failed to fetch locations:', e)),
        this.fetchDepartments().catch(e => console.warn('[STORAGE] ⚠️ Failed to fetch departments:', e)),
      ]);
    } catch(e) {
      console.error('[STORAGE] ❌ Init failed:', e);
    }
    // Populate assetIds on extractions
    const assets = this.getAssets();
    const extractions = this.getExtractions();
    extractions.forEach(ext => {
      ext.assetIds = assets.filter(a => a.extractionId === ext.id).map(a => a.id);
    });
    _cacheSet('ac_extractions', extractions);
    this._extractionsCache = extractions;
    console.log(`✅ Storage ready: ${extractions.length} extractions, ${assets.length} assets`);
  },

  // ─── ASSET IMAGES (localStorage — base64 cache) ────
  getAssetImage(assetId) {
    if (!assetId) return null;
    const imgs = _cacheGet('ac_asset_imgs') || {};
    return imgs[assetId] || null;
  },
  // Alias for backwards compat
  getImage(id) { return this.getAssetImage(id); },

  saveAssetImage(assetId, dataUrl) {
    if (!assetId || !dataUrl) return;
    const imgs = _cacheGet('ac_asset_imgs') || {};
    imgs[assetId] = dataUrl;
    _cacheSet('ac_asset_imgs', imgs);
  },
  // Alias for backwards compat
  saveImage(id, dataUrl) { return this.saveAssetImage(id, dataUrl); },

  removeAssetImage(assetId) {
    const imgs = _cacheGet('ac_asset_imgs') || {};
    delete imgs[assetId];
    _cacheSet('ac_asset_imgs', imgs);
  },

  // ─── VENDOR CUSTOM FIELD HELPERS ───────────────────
  applyVendorCustomFields(asset, vendorProfile) {
    if (!vendorProfile || !asset) return;
    const cf = {};
    (vendorProfile.custom_fields || vendorProfile.customFields || []).forEach(f => {
      cf[f.key] = { label: f.label, value: f.defaultValue || '', type: f.type || 'text', options: f.options || [] };
    });
    asset.customFields = { ...cf, ...(asset.customFields || {}) };
    return asset;
  },

  // Sync vendor match from cache only (safe to call in template literals)
  matchVendorProfileSync(vendorName) {
    if (!vendorName) return null;
    const normalized = vendorName.toLowerCase().trim();
    if (!normalized) return null;
    const profiles = this.getVendorProfiles();
    let match = profiles.find(p => {
      const pn = (p.vendor_name || '').toLowerCase().trim();
      return pn && pn === normalized;
    });
    if (!match) {
      match = profiles.find(p => {
        const pn = (p.vendor_name || '').toLowerCase().trim();
        return pn && (normalized.includes(pn) || pn.includes(normalized));
      });
    }
    return match || null;
  },

  // ─── CLEAR ALL ─────────────────────────────────────
  async clearAll() {
    // Bulk delete from Supabase in FK-safe order
    try {
      await Supabase.deleteWhere('physical_audits');
      await Supabase.deleteWhere('depreciation_entries');
      await Supabase.deleteWhere('asset_invoices');
      await Supabase.deleteWhere('anomaly_alerts');
      await Supabase.deleteWhere('audit_trail');
      await Supabase.deleteWhere('assets');
      await Supabase.deleteWhere('extractions');
      await Supabase.deleteWhere('vendor_profiles');
    } catch(e) { console.warn('[STORAGE] clearAll DB error:', e); }
    // Clear localStorage
    ['ac_extractions','ac_assets','ac_settings','ac_vendor_profiles','ac_templates','ac_locations','ac_departments','ac_asset_imgs'].forEach(k => localStorage.removeItem(k));
    this._extractionsCache = null;
    this._assetsCache = null;
    this._vendorCache = null;
  },
};

window.Storage = Storage;
