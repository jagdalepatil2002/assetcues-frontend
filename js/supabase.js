/**
 * Supabase Client — Assetcues Agentic AI
 * Connects frontend to Supabase backend
 */
const SUPABASE_URL = 'https://ocgywyoehuurkcojaeqm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jZ3l3eW9laHV1cmtjb2phZXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzM4MjAsImV4cCI6MjA5MDM0OTgyMH0.7wBfu42QTj9zYUhfe8KHtZNMktS8ZSEKVJ8zm6jXI48';
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

// Lightweight Supabase REST client (no SDK needed)
const Supabase = {
  _headers() {
    return {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  },

  async query(table, { select = '*', filters = {}, order, limit, single = false } = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    for (const [key, val] of Object.entries(filters)) {
      if (typeof val === 'object' && val !== null) {
        // Support operators: { column: { op: 'eq', value: 'x' } }
        url += `&${key}=${val.op}.${encodeURIComponent(val.value)}`;
      } else {
        url += `&${key}=eq.${encodeURIComponent(val)}`;
      }
    }
    if (order) url += `&order=${order}`;
    if (limit) url += `&limit=${limit}`;
    const headers = this._headers();
    if (single) headers['Accept'] = 'application/vnd.pgrst.object+json';
    console.log(`%c[SUPABASE] SELECT ${table}`, 'color:#7c839b', Object.keys(filters).length ? filters : '');
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.text();
      console.error(`%c[SUPABASE] ❌ SELECT ${table} FAILED (${res.status}):`, 'color:#ba1a1a;font-weight:bold', err);
      return single ? null : [];
    }
    const data = await res.json();
    console.log(`%c[SUPABASE] ✅ SELECT ${table}`, 'color:#7c839b', `→ ${Array.isArray(data) ? data.length : 1} row(s)`);
    return data;
  },

  async insert(table, data) {
    const url = `${SUPABASE_URL}/rest/v1/${table}`;
    const rowCount = Array.isArray(data) ? data.length : 1;
    console.log(`%c[SUPABASE] INSERT ${table}`, 'color:#009668;font-weight:bold', `(${rowCount} row(s))`);
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(Array.isArray(data) ? data : [data])
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`%c[SUPABASE] ❌ INSERT ${table} FAILED (${res.status}):`, 'color:#ba1a1a;font-weight:bold', err);
      return null;
    }
    const result = await res.json();
    console.log(`%c[SUPABASE] ✅ INSERT ${table}`, 'color:#009668', `→ ID: ${result[0]?.id || '?'}`);
    return Array.isArray(data) ? result : result[0];
  },

  async update(table, id, data) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
    console.log(`%c[SUPABASE] UPDATE ${table}`, 'color:#565e74', `ID: ${id}`, Object.keys(data));
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this._headers(),
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`%c[SUPABASE] ❌ UPDATE ${table} FAILED (${res.status}):`, 'color:#ba1a1a;font-weight:bold', err);
      return null;
    }
    const result = await res.json();
    return result[0] || null;
  },

  async upsert(table, data) {
    const url = `${SUPABASE_URL}/rest/v1/${table}`;
    const headers = this._headers();
    headers['Prefer'] = 'return=representation,resolution=merge-duplicates';
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(Array.isArray(data) ? data : [data])
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`Supabase upsert error [${table}]:`, err);
      return null;
    }
    return res.json();
  },

  async delete(table, id) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this._headers()
    });
    return res.ok;
  },

  // Bulk delete by filter (e.g. deleteWhere('assets', { extraction_id: 'xxx' }))
  async deleteWhere(table, filters = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?`;
    const parts = [];
    for (const [key, val] of Object.entries(filters)) {
      parts.push(`${key}=eq.${encodeURIComponent(val)}`);
    }
    if (parts.length === 0) {
      // Delete ALL rows — need a filter that matches everything
      parts.push('id=not.is.null');
    }
    url += parts.join('&');
    console.log(`%c[SUPABASE] DELETE ${table}`, 'color:#ba1a1a;font-weight:bold', filters);
    const res = await fetch(url, { method: 'DELETE', headers: this._headers() });
    if (!res.ok) console.error(`[SUPABASE] deleteWhere ${table} failed:`, await res.text());
    return res.ok;
  },

  async rpc(fnName, params = {}) {
    const url = `${SUPABASE_URL}/rest/v1/rpc/${fnName}`;
    console.log(`%c[SUPABASE] RPC ${fnName}`, 'color:#7c3aed;font-weight:bold', params);
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`Supabase rpc error [${fnName}]:`, err);
      return null;
    }
    const text = await res.text();
    if (!text) return true; // void functions return empty body
    try { return JSON.parse(text); } catch { return true; }
  },

  // File upload to Supabase Storage
  async uploadFile(bucket, path, file) {
    const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: file
    });
    if (!res.ok) return null;
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  },

  getPublicUrl(bucket, path) {
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  }
};

console.log('✅ Supabase client initialized:', SUPABASE_URL);
