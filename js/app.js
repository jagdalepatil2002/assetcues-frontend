/**
 * Assetcues POC — Shared app logic: sidebar injection, settings modal, utilities.
 */

/* ── Inject Global Styles (animations, toasts, buttons) ── */
(function injectGlobalCSS() {
  if (document.getElementById('ac-global-css')) return;
  const style = document.createElement('style');
  style.id = 'ac-global-css';
  style.textContent = `
    /* Staggered fade-in animation */
    @keyframes fadeSlideUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
    .animate-in { opacity:0; animation: fadeSlideUp 0.45s ease-out forwards; }
    .delay-1 { animation-delay:0.04s; } .delay-2 { animation-delay:0.08s; }
    .delay-3 { animation-delay:0.12s; } .delay-4 { animation-delay:0.16s; }
    .delay-5 { animation-delay:0.20s; } .delay-6 { animation-delay:0.24s; }

    /* Button micro-interactions — signature gradient */
    .btn-glow { background: linear-gradient(135deg, #005DA9, #0176D3); color:#fff; border:none;
      transition: all 0.22s ease; box-shadow: 0 2px 10px rgba(0,93,169,0.25); }
    .btn-glow:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,93,169,0.35); }
    .btn-glow:active { transform: translateY(0); box-shadow: 0 2px 6px rgba(0,93,169,0.2); }
    .signature-gradient { background: linear-gradient(135deg, #005DA9 0%, #0176D3 100%); }
    .glass-effect { backdrop-filter: blur(20px); background: rgba(255,255,255,0.85); }

    /* Toast notification */
    @keyframes toastIn { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }
    @keyframes toastOut { from { opacity:1; } to { opacity:0; transform:translateY(-8px); } }
    .ac-toast { position:fixed; bottom:90px; right:24px; padding:14px 22px; border-radius:14px;
      font-size:13px; font-weight:600; font-family:Inter,sans-serif; z-index:9999;
      display:flex; align-items:center; gap:10px; max-width:420px;
      animation: toastIn 0.35s ease-out, toastOut 0.35s ease 2.8s forwards;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15); }
    .ac-toast.success { background:#065f46; color:#6ffbbe; }
    .ac-toast.error { background:#7f1d1d; color:#fca5a5; }
    .ac-toast.info { background:#003366; color:#a4c9ff; }

    /* Confidence ring */
    .confidence-ring { position:relative; width:52px; height:52px; border-radius:50%;
      display:flex; align-items:center; justify-content:center; }
    .confidence-ring::before { content:''; position:absolute; inset:0; border-radius:50%;
      background: conic-gradient(var(--ring-color,#005da9) var(--ring-pct,0%), #e5e7eb var(--ring-pct,0%)); }
    .confidence-ring::after { content:''; position:absolute; inset:4px; border-radius:50%; background:#fff; }
    .confidence-ring span { position:relative; z-index:1; font-size:11px; font-weight:800; }

    /* Card hover lift */
    .card-hover { transition: transform 0.2s ease, box-shadow 0.2s ease; }
    .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.08); }

    /* Smooth modal */
    .modal-enter { animation: modalFadeIn 0.25s ease-out; }
    @keyframes modalFadeIn { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }

    /* AI Agent Chat Widget */
    #ac-agent-fab { position:fixed; bottom:24px; right:24px; z-index:900; width:52px; height:52px; border-radius:50%;
      background:linear-gradient(135deg,#005DA9,#0176D3); color:#fff; border:none; cursor:pointer;
      box-shadow:0 4px 20px rgba(0,93,169,0.35); display:flex; align-items:center; justify-content:center;
      transition:all 0.2s; }
    #ac-agent-fab:hover { transform:scale(1.08); box-shadow:0 6px 28px rgba(0,93,169,0.45); }
    #ac-agent-panel {
      position:fixed; bottom:86px; right:24px; z-index:901;
      width:400px; max-width:calc(100vw - 32px);
      height:560px; max-height:calc(100vh - 100px);
      background:#fff; border-radius:16px;
      box-shadow:0 12px 48px rgba(0,0,0,0.18);
      display:none; flex-direction:column;
      overflow:hidden; border:1px solid #c0c7d4; }
    #ac-agent-panel.open { display:flex; animation:modalFadeIn 0.25s ease-out; }
    #ac-agent-messages {
      flex:1; overflow-y:auto; padding:14px;
      display:flex; flex-direction:column; gap:2px;
      min-height:0; /* critical — lets flexbox shrink correctly */ }
    #ac-agent-messages::-webkit-scrollbar { width:4px; }
    #ac-agent-messages::-webkit-scrollbar-track { background:transparent; }
    #ac-agent-messages::-webkit-scrollbar-thumb { background:#c0c7d4; border-radius:4px; }
    .agent-msg { padding:10px 13px; border-radius:12px; font-size:13px; line-height:1.55; max-width:88%; margin-bottom:4px; word-break:break-word; }
    .agent-msg.user { background:#005da9; color:#fff; margin-left:auto; border-bottom-right-radius:3px; }
    .agent-msg.bot { background:#f3f3f3; color:#1a1c1c; margin-right:auto; border-bottom-left-radius:3px; }
    .agent-msg.bot strong { color:#005da9; }
    .agent-typing { display:flex; gap:4px; padding:10px 14px; background:#f3f3f3; border-radius:12px; width:fit-content; margin-bottom:4px; }
    .agent-typing span { width:6px; height:6px; background:#005da9; border-radius:50%; animation:agentBounce 1.2s infinite; }
    .agent-typing span:nth-child(2) { animation-delay:0.15s; }
    .agent-typing span:nth-child(3) { animation-delay:0.3s; }
    @keyframes agentBounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-8px)} }
    @media(max-width:768px) {
      #ac-agent-fab { bottom:16px; right:16px; width:46px; height:46px; }
      #ac-agent-panel { bottom:74px; right:16px; width:calc(100vw - 32px); height:70vh; max-height:calc(100vh - 90px); }
    }

    /* Mobile responsiveness */
    @media (max-width: 768px) {
      #sidebar { transform: translateX(-100%) !important; position: fixed !important; z-index: 999 !important; width: 260px !important; height: 100vh !important; top: 0 !important; }
      #sidebar.open { transform: translateX(0) !important; }
      .sidebar-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:998; }
      .sidebar-overlay.active { display:block; }
      main { margin-left: 0 !important; padding-bottom: 88px !important; }
      .px-6, .px-8 { padding-left: 16px !important; padding-right: 16px !important; }
      .grid-cols-12 { grid-template-columns: 1fr !important; }
      .lg\\:col-span-8, .lg\\:col-span-7, .lg\\:col-span-4, .lg\\:col-span-5 { grid-column: span 1 !important; }
      h3.text-3xl { font-size: 1.25rem !important; }
      h3.text-4xl { font-size: 1.5rem !important; }
      .text-2xl { font-size: 1.125rem !important; }
      table { font-size: 12px; }
      table th, table td { padding: 6px 8px !important; }
      .hidden-mobile { display: none !important; }
    }
  `;
  document.head.appendChild(style);
})();

/* ── Format helpers ── */
function formatCurrency(n) {
  if (n == null || isNaN(n)) return '₹0';
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
function formatDate(d) {
  if (!d) return '—';
  try {
    let input = d;
    // If date-only string (YYYY-MM-DD), parse as local time to avoid off-by-one in negative UTC zones
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
      input = d.trim() + 'T00:00:00';
    }
    const dt = new Date(input);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return d; }
}
function formatConfidence(c) {
  if (c == null) return '—';
  return Math.round(c * 100) + '%';
}
function timeAgo(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  if (isNaN(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}
function getVal(obj, key) {
  // Handle both {value: x, confidence: y} and plain value patterns
  if (obj == null) return null;
  const v = obj[key];
  if (v && typeof v === 'object' && 'value' in v) return v.value;
  return v;
}

/* ── Sidebar injection ── */
function getNavItems() {
  return [
    { icon: 'dashboard', label: 'Dashboard', href: 'index.html', fill: true },
    { icon: 'upload_file', label: 'Upload', href: 'upload.html', fill: false },
    { icon: 'rate_review', label: 'Review', href: 'review.html', fill: false },
    { icon: 'inventory_2', label: 'Asset Registry', href: 'registry.html', fill: false },
    { icon: 'store', label: 'Vendor Profiles', href: 'vendors.html', fill: false },
    { icon: 'qr_code_scanner', label: 'Scan Asset', href: 'scanner.html', fill: false },
    { icon: 'summarize', label: 'Audit Reports', href: 'audit-report.html', fill: false },
    { icon: 'category', label: 'Templates', href: 'templates.html', fill: false },
  ];
}

function injectSidebar(activePage) {
  const aside = document.getElementById('sidebar');
  if (!aside) return;
  const nav = getNavItems();
  const stats = Storage.getDashboardStats();

  aside.innerHTML = `
    <div class="px-6 mb-4 mt-3">
      <a href="upload.html" class="w-full signature-gradient text-on-primary py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-md hover:opacity-90 transition-opacity no-underline">
        <span class="material-symbols-outlined text-sm" data-icon="add">add</span>
        <span class="font-bold text-xs">New Upload</span>
      </a>
    </div>

    <nav class="flex-1 space-y-0.5">
      ${nav.map(item => {
        const isActive = item.href === activePage;
        if (isActive) {
          return `
            <a class="bg-blue-50 text-blue-700 border-r-4 border-blue-700 font-bold px-6 py-2.5 flex items-center gap-3 translate-x-1 transition-transform duration-200 no-underline" href="${item.href}">
              <span class="material-symbols-outlined text-blue-700" style="font-variation-settings: 'FILL' 1">${item.icon}</span>
              <span class="font-medium text-sm">${item.label}</span>
              ${item.label === 'Review' && stats.pending > 0 ? `<span class="ml-auto text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded">${stats.pending}</span>` : ''}
            </a>
          `;
        } else {
          return `
            <a class="text-slate-600 px-6 py-2.5 flex items-center gap-3 hover:bg-slate-200/50 transition-colors no-underline" href="${item.href}">
              <span class="material-symbols-outlined">${item.icon}</span>
              <span class="font-medium text-sm">${item.label}</span>
              ${item.label === 'Review' && stats.pending > 0 ? `<span class="ml-auto text-[10px] font-bold bg-error text-white px-1.5 py-0.5 rounded">${stats.pending}</span>` : ''}
            </a>
          `;
        }
      }).join('')}
    </nav>
    <div class="border-t border-slate-200 pt-3 pb-4">
      <button onclick="if(confirm('Clear all POC data?')){Storage.clearAll().then(()=>location.reload())}" class="w-full text-slate-500 hover:text-red-600 px-6 py-2 flex items-center gap-3 hover:bg-red-50 transition-colors text-left">
        <span class="material-symbols-outlined text-[18px]">delete_sweep</span>
        <span class="font-medium text-sm">Clear Data</span>
      </button>
    </div>
  `;

  // Inject mobile bottom nav
  if (!document.getElementById('ac-bottom-nav')) {
    const bottomNav = document.createElement('nav');
    bottomNav.id = 'ac-bottom-nav';
    bottomNav.className = 'md:hidden fixed bottom-0 left-0 w-full h-20 flex justify-around items-center px-4 pb-safe bg-white/80 backdrop-blur-xl z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] border-t border-slate-200/20';
    const mobileItems = [
      { icon: 'dashboard', label: 'Home', href: 'index.html' },
      { icon: 'inventory_2', label: 'Assets', href: 'registry.html' },
      { icon: 'qr_code_scanner', label: 'Scanner', href: 'scanner.html', fab: true },
      { icon: 'assignment_turned_in', label: 'Audits', href: 'audit-report.html' },
      { icon: 'menu', label: 'More', href: '#', onclick: 'toggleMobileSidebar()' },
    ];
    bottomNav.innerHTML = mobileItems.map(item => {
      const isActive = item.href === activePage;
      if (item.fab) {
        return `<a href="${item.href}" class="flex flex-col items-center justify-center -mt-8 no-underline">
          <div class="w-14 h-14 signature-gradient rounded-full flex items-center justify-center shadow-lg shadow-primary/30 active:scale-90 transition-transform">
            <span class="material-symbols-outlined text-white text-2xl">${item.icon}</span>
          </div>
          <span class="text-[0.65rem] font-bold uppercase tracking-widest mt-1 text-slate-500">${item.label}</span>
        </a>`;
      }
      return `<${item.onclick ? 'button onclick="'+item.onclick+'"' : 'a href="'+item.href+'"'} class="flex flex-col items-center justify-center no-underline ${isActive ? 'text-blue-700 font-semibold' : 'text-slate-400'}">
        <span class="material-symbols-outlined mb-0.5" ${isActive ? 'style="font-variation-settings:\'FILL\' 1"' : ''}>${item.icon}</span>
        <span class="text-[0.65rem] font-bold uppercase tracking-widest">${item.label}</span>
      </${item.onclick ? 'button' : 'a'}>`;
    }).join('');
    document.body.appendChild(bottomNav);
  }
}

/* ── Top Bar ── */
function injectTopBar(title) {
  const header = document.getElementById('topbar');
  if (!header) return;
  header.innerHTML = `
    <div class="flex items-center gap-4">
      <button class="md:hidden p-2 text-on-surface-variant" onclick="toggleMobileSidebar()">
        <span class="material-symbols-outlined">menu</span>
      </button>
      <img src="img/logo.png" alt="AssetCues" class="h-11 w-auto" />
      <div id="connection-dot" class="w-2.5 h-2.5 rounded-full bg-outline animate-pulse" title="Checking backend..."></div>
    </div>
    <div class="flex items-center gap-3">
      <div class="hidden md:flex items-center relative w-72">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px] pointer-events-none">search</span>
        <input id="global-search" class="w-full pl-10 pr-4 py-2 rounded-lg bg-surface border border-outline-variant/30 text-[13px] font-medium text-on-surface placeholder-on-surface-variant focus:ring-2 focus:ring-primary focus:border-primary focus:bg-white outline-none transition-all" placeholder="Search asset ID, serial, vendor..." type="text" onkeydown="if(event.key==='Enter')globalSearch(this.value)"/>
      </div>
      <button onclick="toggleNotifications()" class="p-2 text-slate-600 hover:bg-slate-100 transition-colors rounded-full relative" id="notif-btn">
        <span class="material-symbols-outlined">notifications</span>
        <span class="absolute top-2 right-2 w-2 h-2 bg-error rounded-full animate-pulse hidden" id="notif-dot"></span>
      </button>
      <div id="notif-panel" class="hidden absolute top-14 right-16 w-80 max-h-96 bg-white rounded-xl shadow-2xl border border-outline-variant/20 overflow-hidden z-[100]">
        <div class="px-4 py-3 border-b border-surface-container flex justify-between items-center">
          <h4 class="text-sm font-bold">Notifications</h4>
          <span class="text-[10px] font-bold text-primary" id="notif-count">0</span>
        </div>
        <div id="notif-list" class="overflow-y-auto max-h-72 divide-y divide-surface-container">
          <p class="text-xs text-on-surface-variant text-center py-8">No notifications</p>
        </div>
      </div>
      <button onclick="openSettings()" class="hidden md:block p-2 text-slate-600 hover:bg-slate-100 transition-colors rounded-full">
        <span class="material-symbols-outlined">settings</span>
      </button>
      <div class="hidden md:flex items-center gap-2 pl-2 ml-1 border-l border-outline-variant/30">
        <div class="text-right">
          <p class="text-xs font-bold text-on-surface leading-none">Admin</p>
          <p class="text-[9px] text-on-surface-variant">Manager</p>
        </div>
        <div class="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">A</div>
      </div>
    </div>
  `;
  // Check connection now + every 5 min
  checkConnection();
  setInterval(checkConnection, 5 * 60 * 1000);
}

async function checkConnection() {
  const dot = document.getElementById('connection-dot');
  if (!dot) return;
  const health = await Api.checkHealth();
  if (health.ok) {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
    dot.title = 'Backend connected';
  } else {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-error animate-pulse cursor-pointer';
    dot.title = 'Backend offline — click to configure';
    dot.onclick = openSettings;
  }
}

/* ── Settings Modal ── */
function openSettings() {
  let modal = document.getElementById('settings-modal');
  if (modal) {
    // Refresh input values from current settings before showing
    const s = Storage.getSettings();
    const urlInput = document.getElementById('settings-url');
    const tenantInput = document.getElementById('settings-tenant');
    if (urlInput) urlInput.value = s.apiUrl;
    if (tenantInput) tenantInput.value = s.tenantId;
    const testResult = document.getElementById('settings-test-result');
    if (testResult) testResult.innerHTML = '';
    modal.classList.remove('hidden');
    return;
  }
  const s = Storage.getSettings();
  modal = document.createElement('div');
  modal.id = 'settings-modal';
  modal.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-[999] backdrop-blur-sm';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 relative">
      <button onclick="document.getElementById('settings-modal').classList.add('hidden')" class="absolute top-4 right-4 p-1 text-on-surface-variant hover:text-on-surface">
        <span class="material-symbols-outlined">close</span>
      </button>
      <h3 class="font-headline font-bold text-xl mb-6">POC Settings</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Backend API URL</label>
          <input id="settings-url" type="text" value="${s.apiUrl}" class="w-full px-4 py-3 rounded-lg border border-outline-variant/30 text-sm font-medium focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none" placeholder="http://localhost:8000" />
        </div>
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Tenant ID</label>
          <input id="settings-tenant" type="text" value="${s.tenantId}" class="w-full px-4 py-3 rounded-lg border border-outline-variant/30 text-sm font-medium focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none" placeholder="poc" />
        </div>
        <div id="settings-test-result" class="text-sm"></div>
        <div class="flex gap-3 pt-2">
          <button onclick="testConnection()" class="flex-1 py-3 bg-surface-container text-on-surface rounded-lg font-bold text-sm hover:bg-surface-container-high transition-colors">Test Connection</button>
          <button onclick="saveSettingsModal()" class="flex-1 py-3 bg-primary text-white rounded-lg font-bold text-sm hover:opacity-90 transition-all">Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function testConnection() {
  const url = document.getElementById('settings-url').value.trim();
  const result = document.getElementById('settings-test-result');
  result.innerHTML = '<span class="text-on-surface-variant">Testing...</span>';
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) result.innerHTML = '<span class="text-on-tertiary-container font-bold">✓ Connected successfully</span>';
    else result.innerHTML = `<span class="text-error font-bold">✗ HTTP ${res.status}</span>`;
  } catch(e) {
    result.innerHTML = `<span class="text-error font-bold">✗ ${e.message}</span>`;
  }
}

function saveSettingsModal() {
  const url = document.getElementById('settings-url').value.trim();
  const tenant = document.getElementById('settings-tenant').value.trim();
  Storage.saveSettings({ apiUrl: url || 'http://localhost:8000', tenantId: tenant || 'poc' });
  document.getElementById('settings-modal').classList.add('hidden');
  checkConnection();
}

/* ── Confidence badge helper ── */
function confidenceBadge(c) {
  if (c == null) return `<span class="px-3 py-1 rounded text-[10px] font-bold bg-surface-container text-on-surface-variant inline-flex items-center gap-1"><span class="material-symbols-outlined text-xs">help</span>N/A</span>`;
  const pct = Math.round(c * 100);
  if (pct >= 90) return `<span class="px-3 py-1 rounded text-[10px] font-bold bg-tertiary-fixed/20 text-on-tertiary-container inline-flex items-center gap-1"><span class="material-symbols-outlined text-xs" style="font-variation-settings: 'FILL' 1;">check_circle</span>${pct}% CONFIDENCE</span>`;
  if (pct >= 70) return `<span class="px-3 py-1 rounded text-[10px] font-bold bg-secondary-fixed/20 text-on-secondary-container inline-flex items-center gap-1"><span class="material-symbols-outlined text-xs">info</span>${pct}% CONFIDENCE</span>`;
  return `<span class="px-3 py-1 rounded text-[10px] font-bold bg-error-container text-error inline-flex items-center gap-1"><span class="material-symbols-outlined text-xs">priority_high</span>${pct}% CONFIDENCE</span>`;
}

function statusBadge(status) {
  const map = {
    draft:     '<span class="px-2.5 py-1 text-[10px] font-bold rounded-full bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-wide">Draft</span>',
    approved:  '<span class="px-2.5 py-1 text-[10px] font-bold rounded-full bg-green-100 text-green-700 border border-green-200 uppercase tracking-wide">✓ Verified</span>',
    verified:  '<span class="px-2.5 py-1 text-[10px] font-bold rounded-full bg-green-100 text-green-700 border border-green-200 uppercase tracking-wide">✓ Verified</span>',
    in_review: '<span class="px-2.5 py-1 text-[10px] font-bold rounded-full bg-blue-100 text-blue-700 border border-blue-200 uppercase tracking-wide">In Review</span>',
    rejected:  '<span class="px-2.5 py-1 text-[10px] font-bold rounded-full bg-red-100 text-red-700 border border-red-200 uppercase tracking-wide">Rejected</span>',
    retired:   '<span class="px-2.5 py-1 text-[10px] font-bold rounded-full bg-gray-100 text-gray-500 border border-gray-200 uppercase tracking-wide">Retired</span>',
  };
  return map[status] || map.draft;
}

window.formatCurrency = formatCurrency;
window.formatDate = formatDate;
window.formatConfidence = formatConfidence;
window.timeAgo = timeAgo;
window.getVal = getVal;
window.injectSidebar = injectSidebar;
window.injectTopBar = injectTopBar;
window.openSettings = openSettings;
window.testConnection = testConnection;
window.saveSettingsModal = saveSettingsModal;
window.checkConnection = checkConnection;
window.confidenceBadge = confidenceBadge;
window.statusBadge = statusBadge;

/* ── Toast Notification ── */
function showToast(message, type = 'success') {
  const existing = document.querySelector('.ac-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `ac-toast ${type}`;
  const icons = { success: 'check_circle', error: 'error', info: 'info' };
  toast.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;font-variation-settings:'FILL' 1">${icons[type] || 'info'}</span>${message}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}
window.showToast = showToast;

/* ── Count-Up Animation for KPI Numbers ── */
function animateCount(el, target, duration = 900) {
  if (!el || isNaN(target)) return;
  const isFloat = target % 1 !== 0;
  let start = 0;
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = eased * target;
    el.textContent = isFloat ? current.toFixed(1) : Math.floor(current).toLocaleString('en-IN');
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
window.animateCount = animateCount;

/* ── Confidence Ring HTML ── */
function confidenceRing(c) {
  if (c == null) return `<span class="text-xs text-on-surface-variant">N/A</span>`;
  const pct = Math.round(c * 100);
  const color = pct >= 90 ? '#059669' : pct >= 70 ? '#005da9' : '#dc2626';
  return `<div class="confidence-ring" style="--ring-pct:${pct}%;--ring-color:${color}"><span style="color:${color}">${pct}%</span></div>`;
}
window.confidenceRing = confidenceRing;

/* ── Auto-apply staggered animations to page content ── */
function animatePageContent(containerSelector) {
  const container = document.querySelector(containerSelector || 'main .px-6, main .px-8');
  if (!container) return;
  const children = container.children;
  for (let i = 0; i < children.length; i++) {
    children[i].classList.add('animate-in');
    const delayClass = `delay-${Math.min(i + 1, 6)}`;
    children[i].classList.add(delayClass);
  }
}
window.animatePageContent = animatePageContent;

/* ── Global Search ── */
function globalSearch(query) {
  if (!query || !query.trim()) return;
  const q = query.trim().toLowerCase();
  const assets = Storage.getAssets();
  const match = assets.find(a =>
    (a.tempAssetId || '').toLowerCase().includes(q) ||
    (a.name || '').toLowerCase().includes(q) ||
    (a.serialNumber || '').toLowerCase().includes(q) ||
    (a.barcode || '').toLowerCase().includes(q) ||
    String(a.assetId).includes(q) ||
    (a.vendor || '').toLowerCase().includes(q) ||
    (a.invoiceNumber || '').toLowerCase().includes(q)
  );
  if (match) {
    window.location.href = `asset-detail.html?id=${match.id}`;
  } else {
    // Try extractions
    const extractions = Storage.getExtractions();
    const extMatch = extractions.find(e =>
      (e.invoiceNumber || '').toLowerCase().includes(q) ||
      (e.vendorName || '').toLowerCase().includes(q) ||
      (e.fileName || '').toLowerCase().includes(q)
    );
    if (extMatch) {
      window.location.href = `review-detail.html?id=${extMatch.id}`;
    } else {
      showToast(`No results for "${query}"`, 'info');
    }
  }
}
window.globalSearch = globalSearch;

/* ── Notification System ── */
function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  if (panel) panel.classList.toggle('hidden');
}
window.toggleNotifications = toggleNotifications;

// Close notifications when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notif-panel');
  const btn = document.getElementById('notif-btn');
  if (panel && !panel.classList.contains('hidden') && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.add('hidden');
  }
});

async function loadNotifications() {
  const items = [];
  const assets = Storage.getAssets();
  const now = new Date();

  // Warranty expiring within 30 days
  assets.forEach(a => {
    if (!a.warrantyEndDate) return;
    const exp = new Date(a.warrantyEndDate);
    const days = Math.ceil((exp - now) / (1000*60*60*24));
    if (days > 0 && days <= 30) {
      items.push({ icon: 'shield', color: 'text-amber-600 bg-amber-50', title: `Warranty expiring: ${a.shortName || a.name}`, detail: `${days} day${days>1?'s':''} remaining`, href: `asset-detail.html?id=${a.id}` });
    } else if (days <= 0 && days > -30) {
      items.push({ icon: 'warning', color: 'text-error bg-error-container', title: `Warranty EXPIRED: ${a.shortName || a.name}`, detail: `Expired ${Math.abs(days)} day${Math.abs(days)>1?'s':''} ago`, href: `asset-detail.html?id=${a.id}` });
    }
  });

  // Pending reviews
  const pending = Storage.getExtractions().filter(e => e.status === 'draft');
  pending.forEach(e => {
    items.push({ icon: 'rate_review', color: 'text-primary bg-primary-fixed', title: `Pending review: ${e.invoiceNumber || e.fileName}`, detail: `From ${e.vendorName || 'Unknown'}`, href: `review-detail.html?id=${e.id}` });
  });

  // Anomaly alerts
  try {
    const alerts = await Storage.fetchAlerts();
    (alerts || []).forEach(al => {
      items.push({ icon: 'error', color: 'text-error bg-error-container', title: al.title, detail: al.description || '', href: '#' });
    });
  } catch {}

  // Update UI
  const dot = document.getElementById('notif-dot');
  const count = document.getElementById('notif-count');
  const list = document.getElementById('notif-list');
  if (dot) dot.classList.toggle('hidden', items.length === 0);
  if (count) count.textContent = items.length > 0 ? `${items.length} new` : '0';
  if (list) {
    if (items.length === 0) {
      list.innerHTML = '<p class="text-xs text-on-surface-variant text-center py-8">All clear — no notifications</p>';
    } else {
      list.innerHTML = items.map(n => `
        <a href="${n.href}" class="flex items-start gap-3 px-4 py-3 hover:bg-surface-container-low transition-colors no-underline">
          <div class="w-8 h-8 rounded-lg ${n.color} flex items-center justify-center shrink-0 mt-0.5">
            <span class="material-symbols-outlined text-sm">${n.icon}</span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-bold text-on-surface truncate">${n.title}</p>
            <p class="text-[10px] text-on-surface-variant truncate">${n.detail}</p>
          </div>
        </a>
      `).join('');
    }
  }
}
// Auto-load notifications after Storage.init
const _origInit = Storage.init.bind(Storage);
Storage.init = async function() {
  await _origInit();
  setTimeout(loadNotifications, 500);
};
window.loadNotifications = loadNotifications;

/* ── Mobile Sidebar Toggle ── */
function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    sidebar.classList.remove('open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.classList.remove('active');
  } else {
    sidebar.classList.add('open');
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      overlay.onclick = toggleMobileSidebar;
      document.body.appendChild(overlay);
    }
    overlay.classList.add('active');
  }
}
window.toggleMobileSidebar = toggleMobileSidebar;

// Close sidebar on any nav click (mobile)
document.addEventListener('click', (e) => {
  const link = e.target.closest('#sidebar a[href]');
  if (link && window.innerWidth < 768) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.classList.remove('active');
  }
});

/* ── AssetCues AI Agent Chat Widget ── */
const _agentHistory = []; // multi-turn conversation history

const _agentQuickPrompts = [
  { icon: 'warning', label: 'Warranty expiring soon', q: 'Which assets have warranty expiring in the next 60 days?' },
  { icon: 'inventory_2', label: 'Top vendors', q: 'Which vendors do I have the most assets from?' },
  { icon: 'attach_money', label: 'Highest value assets', q: 'List my top 5 highest value assets with their costs.' },
  { icon: 'search', label: 'Find by serial', q: 'How do I find an asset by serial number?' },
  { icon: 'category', label: 'Category breakdown', q: 'Give me a breakdown of assets by category.' },
  { icon: 'event_busy', label: 'AMC renewals', q: 'Which assets have AMC contracts ending soon?' },
];

(function initAgentWidget() {
  if (document.getElementById('ac-agent-fab')) return;

  // FAB button
  const fab = document.createElement('button');
  fab.id = 'ac-agent-fab';
  fab.title = 'AssetCues AI Agent';
  fab.innerHTML = '<span class="material-symbols-outlined text-2xl" style="font-variation-settings:\'FILL\' 1">smart_toy</span>';
  fab.onclick = () => {
    const panel = document.getElementById('ac-agent-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) document.getElementById('ac-agent-input').focus();
  };
  document.body.appendChild(fab);

  // Quick prompt chips HTML
  const chipsHtml = `
    <div id="ac-agent-chips" style="padding:8px 12px 6px;display:flex;flex-wrap:wrap;gap:5px;border-bottom:1px solid #f0f0f0;">
      ${_agentQuickPrompts.map((p, i) => `
        <button onclick="agentQuickAsk(${i})"
          style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;border:1px solid #c0c7d4;background:#fff;font-size:11px;font-weight:600;color:#005da9;cursor:pointer;transition:all 0.15s;white-space:nowrap;"
          onmouseover="this.style.background='#005da9';this.style.color='#fff';this.style.borderColor='#005da9'"
          onmouseout="this.style.background='#fff';this.style.color='#005da9';this.style.borderColor='#c0c7d4'">
          <span class="material-symbols-outlined" style="font-size:12px;font-variation-settings:'FILL' 1">${p.icon}</span>
          ${p.label}
        </button>`).join('')}
    </div>`;

  // Chat panel
  const panel = document.createElement('div');
  panel.id = 'ac-agent-panel';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #c0c7d420;background:#f3f3f3;">
      <div style="width:32px;height:32px;background:linear-gradient(135deg,#005DA9,#0176D3);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <span class="material-symbols-outlined" style="color:#fff;font-size:16px;font-variation-settings:'FILL' 1">smart_toy</span>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#1a1c1c;">AssetCues AI Assistant</div>
        <div style="font-size:10px;color:#717784;">Powered by AssetCues AI</div>
      </div>
      <button onclick="_agentClearHistory()" title="Clear chat" style="padding:4px;color:#717784;background:none;border:none;cursor:pointer;border-radius:6px;" onmouseover="this.style.background='#e8e8e8'" onmouseout="this.style.background='none'">
        <span class="material-symbols-outlined" style="font-size:16px;">delete_sweep</span>
      </button>
      <button onclick="document.getElementById('ac-agent-panel').classList.remove('open')" style="padding:4px;color:#717784;background:none;border:none;cursor:pointer;border-radius:6px;" onmouseover="this.style.background='#e8e8e8'" onmouseout="this.style.background='none'">
        <span class="material-symbols-outlined" style="font-size:16px;">close</span>
      </button>
    </div>
    <div id="ac-agent-messages">
      <div class="agent-msg bot">Hello! I'm your <strong>AssetCues AI Assistant</strong>. Ask me anything about your assets, invoices, vendors, or compliance — or pick a quick question below.</div>
    </div>
    ${chipsHtml}
    <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #c0c7d420;">
      <input id="ac-agent-input" type="text" placeholder="Ask about your assets..."
        style="flex:1;padding:8px 12px;background:#f3f3f3;border:none;border-radius:8px;font-size:13px;outline:none;font-family:inherit;"
        onfocus="this.style.boxShadow='0 0 0 2px #005da940'" onblur="this.style.boxShadow='none'"
        onkeydown="if(event.key==='Enter')sendAgentMessage()" />
      <button onclick="sendAgentMessage()" style="width:36px;height:36px;background:linear-gradient(135deg,#005DA9,#0176D3);border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">
        <span class="material-symbols-outlined" style="color:#fff;font-size:16px;">send</span>
      </button>
    </div>
  `;
  document.body.appendChild(panel);
})();

function agentQuickAsk(idx) {
  const p = _agentQuickPrompts[idx];
  if (!p) return;
  document.getElementById('ac-agent-input').value = p.q;
  sendAgentMessage();
}

function _agentClearHistory() {
  _agentHistory.length = 0;
  const messages = document.getElementById('ac-agent-messages');
  messages.innerHTML = '<div class="agent-msg bot">Chat cleared. Hello again! Ask me anything about your assets, invoices, or compliance data.</div>';
}
window._agentClearHistory = _agentClearHistory;
window.agentQuickAsk = agentQuickAsk;

function _buildAgentContext() {
  const assets = Storage.getAssets();
  const extractions = Storage.getExtractions();
  const today = new Date();
  const in90 = new Date(today); in90.setDate(in90.getDate() + 90);

  const totalValue = assets.reduce((s, a) => s + (a.totalCost || 0), 0);
  const categories = {};
  const vendorCounts = {};
  assets.forEach(a => {
    categories[a.category || 'Unknown'] = (categories[a.category || 'Unknown'] || 0) + 1;
    vendorCounts[a.vendor || 'Unknown'] = (vendorCounts[a.vendor || 'Unknown'] || 0) + 1;
  });

  // Warranty expiring within 90 days
  const warrantyExpiring = assets.filter(a => {
    if (!a.warrantyEndDate) return false;
    const d = new Date(a.warrantyEndDate);
    return d >= today && d <= in90;
  }).map(a => `${a.tempAssetId}|${a.name}|expires:${a.warrantyEndDate}|vendor:${a.vendor||''}`);

  // AMC expiring within 90 days
  const amcExpiring = assets.filter(a => {
    if (!a.amcEndDate) return false;
    const d = new Date(a.amcEndDate);
    return d >= today && d <= in90;
  }).map(a => `${a.tempAssetId}|${a.name}|amc-ends:${a.amcEndDate}|provider:${a.amcProvider||''}`);

  // Full asset list with all searchable fields
  const assetList = assets.map(a =>
    `${a.tempAssetId}|${a.name}|serial:${a.serialNumber||'none'}|hsn:${a.hsnCode||'none'}|vendor:${a.vendor||''}|category:${a.category||''}|cost:₹${a.totalCost||0}|status:${a.status}|invoice:${a.invoiceNumber||''}|date:${a.acquisitionDate||''}|warranty:${a.warrantyEndDate||''}|amc-end:${a.amcEndDate||''}`
  ).join('\n');

  return `ASSET MANAGEMENT DATA (as of ${today.toISOString().split('T')[0]}):
Total assets: ${assets.length} | Total value: ₹${totalValue.toLocaleString('en-IN')}
Categories: ${JSON.stringify(categories)}
Vendors: ${JSON.stringify(vendorCounts)}
Invoices processed: ${extractions.map(e => `${e.invoiceNumber||'N/A'} | ${e.vendorName||'Unknown'} | ${e.status}`).join('; ')}

WARRANTY EXPIRING WITHIN 90 DAYS (${warrantyExpiring.length} assets):
${warrantyExpiring.length ? warrantyExpiring.join('\n') : 'None'}

AMC EXPIRING WITHIN 90 DAYS (${amcExpiring.length} assets):
${amcExpiring.length ? amcExpiring.join('\n') : 'None'}

FULL ASSET LIST (format: AssetID|Name|serial|hsn|vendor|category|cost|status|invoice|date|warranty|amc-end):
${assetList}`;
}

function _renderAgentMarkdown(text) {
  // Build asset ID → detail page link map
  const assets = Storage.getAssets();
  const assetIdMap = {};
  assets.forEach(a => { if (a.tempAssetId) assetIdMap[a.tempAssetId] = a.id; });

  let html = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:#e2e2e2;padding:1px 6px;border-radius:3px;font-size:11.5px;font-family:monospace">$1</code>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<p style="font-weight:700;color:#005da9;margin:8px 0 2px">$1</p>')
    .replace(/^[-•]\s+(.+)$/gm, '<div style="display:flex;gap:6px;margin:2px 0"><span style="color:#005da9;margin-top:1px">•</span><span>$1</span></div>')
    .replace(/\n{2,}/g, '</p><p style="margin-top:8px">')
    .replace(/\n/g, '<br>');

  // Linkify asset IDs like AC-0001, AC-0042 etc.
  html = html.replace(/\b(AC-\d{4,})\b/g, (match) => {
    const dbId = assetIdMap[match];
    if (dbId) return `<a href="asset-detail.html?id=${dbId}" style="color:#005da9;font-weight:700;text-decoration:underline;text-underline-offset:2px" title="Open ${match}">${match} ↗</a>`;
    return `<strong>${match}</strong>`;
  });

  return html;
}

// ── Local intent detection — handle without AI ──
function _agentLocalIntent(question) {
  const q = question.trim();
  const assets = Storage.getAssets();

  // Pure numeric → search by asset number (e.g. "1001" → AC-1001 or tempAssetId ending in 1001)
  if (/^\d+$/.test(q)) {
    const num = q.padStart(4, '0');
    const asset = assets.find(a =>
      a.tempAssetId === `AC-${num}` ||
      a.tempAssetId === q ||
      String(a.assetNumber || '').replace(/^0+/, '') === String(parseInt(q, 10))
    );
    return { type: 'asset_lookup', asset, query: q };
  }

  // "show me", "open", "find", "get" + number or AC-XXXX
  const showMatch = q.match(/(?:show\s+me|open|find|get|go\s+to)\s+(?:asset\s+)?(?:AC-)?(\d{1,6})/i);
  if (showMatch) {
    const num = showMatch[1].padStart(4, '0');
    const asset = assets.find(a =>
      a.tempAssetId === `AC-${num}` ||
      a.tempAssetId === `AC-${showMatch[1]}` ||
      String(a.assetNumber || '') === showMatch[1]
    );
    return { type: 'asset_lookup', asset, query: showMatch[1] };
  }

  // "show me AC-0042"
  const acMatch = q.match(/(?:show\s+me|open|find|get)?\s*(AC-\d{4,})/i);
  if (acMatch) {
    const asset = assets.find(a => a.tempAssetId === acMatch[1].toUpperCase());
    return { type: 'asset_lookup', asset, query: acMatch[1] };
  }

  return null;
}

function _renderAssetActionCard(asset, query) {
  if (!asset) {
    return `<div class="agent-msg bot">No asset found for <strong>${query}</strong>. Try a different asset number or serial.</div>`;
  }
  return `<div class="agent-msg bot" style="padding:0;overflow:hidden;">
    <div style="padding:10px 14px 8px;font-size:12px;color:#717784;">Found asset</div>
    <div style="padding:0 14px 12px;">
      <div style="font-weight:700;font-size:14px;color:#1a1c1c;">${asset.name || 'Unnamed Asset'}</div>
      <div style="font-size:11px;color:#717784;margin-top:2px;">${asset.tempAssetId} • ${asset.category || '—'} • ${asset.vendor || '—'}</div>
      ${asset.serialNumber ? `<div style="font-size:11px;font-family:monospace;color:#005da9;margin-top:2px;">SN: ${asset.serialNumber}</div>` : ''}
      <div style="font-size:12px;font-weight:600;color:#1a1c1c;margin-top:4px;">${asset.totalCost ? '₹' + Number(asset.totalCost).toLocaleString('en-IN') : ''}</div>
    </div>
    <a href="asset-detail.html?id=${asset.id}" style="display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;background:#005da9;color:#fff;font-size:12px;font-weight:700;text-decoration:none;">
      <span class="material-symbols-outlined" style="font-size:15px;">open_in_new</span> Open Asset
    </a>
  </div>`;
}

async function sendAgentMessage() {
  const input = document.getElementById('ac-agent-input');
  const messages = document.getElementById('ac-agent-messages');
  const question = input.value.trim();
  if (!question) return;

  // Hide quick chips after first message
  const chips = document.getElementById('ac-agent-chips');
  if (chips) chips.style.display = 'none';

  messages.innerHTML += `<div class="agent-msg user">${question}</div>`;
  input.value = '';
  messages.scrollTop = messages.scrollHeight;

  // ── Local intent: numeric or "show me" — no AI needed ──
  const intent = _agentLocalIntent(question);
  if (intent && intent.type === 'asset_lookup') {
    messages.innerHTML += _renderAssetActionCard(intent.asset, intent.query);
    messages.scrollTop = messages.scrollHeight;
    return;
  }

  // ── AI path: streaming ──
  _agentHistory.push({ role: 'user', content: question });
  if (_agentHistory.length > 20) _agentHistory.splice(0, 2);

  // Create streaming bot bubble
  const botId = `bot-msg-${Date.now()}`;
  messages.innerHTML += `<div class="agent-msg bot" id="${botId}"><span style="opacity:0.5">▍</span></div>`;
  messages.scrollTop = messages.scrollHeight;

  const baseUrl = Storage.getSettings().apiUrl || 'https://assetcues-backend.onrender.com';
  const context = _buildAgentContext();
  let rawAnswer = '';
  let streamOk = false;

  try {
    const res = await fetch(`${baseUrl}/api/v1/agent/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context, history: _agentHistory.slice(0, -1) }),
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    streamOk = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const bubble = document.getElementById(botId);
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const obj = JSON.parse(payload);
          if (obj.chunk) {
            rawAnswer += obj.chunk;
            if (bubble) bubble.innerHTML = _renderAgentMarkdown(rawAnswer) + '<span style="opacity:0.5">▍</span>';
            messages.scrollTop = messages.scrollHeight;
          }
          if (obj.error) throw new Error(obj.error);
        } catch (_) { /* skip malformed lines */ }
      }
    }

    // Final render without cursor
    const bubble2 = document.getElementById(botId);
    if (bubble2) bubble2.innerHTML = _renderAgentMarkdown(rawAnswer || 'No response');
    _agentHistory.push({ role: 'assistant', content: rawAnswer });

  } catch (e) {
    // Fallback to non-streaming if stream endpoint fails
    if (!streamOk) {
      const bubble = document.getElementById(botId);
      if (bubble) bubble.innerHTML = '<span style="opacity:0.5">Thinking…</span>';
      try {
        const res2 = await fetch(`${baseUrl}/api/v1/agent/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, context, history: _agentHistory.slice(0, -1) }),
        });
        if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
        const data = await res2.json();
        rawAnswer = data.answer || 'No response';
        _agentHistory.push({ role: 'assistant', content: rawAnswer });
        const bubble2 = document.getElementById(botId);
        if (bubble2) bubble2.innerHTML = _renderAgentMarkdown(rawAnswer);
      } catch (e2) {
        _agentHistory.pop();
        const bubble2 = document.getElementById(botId);
        if (bubble2) bubble2.innerHTML = '<span style="color:#ba1a1a">Sorry, I couldn\'t reach the AI backend. Check your connection or API URL in Settings.</span>';
      }
    } else {
      const bubble2 = document.getElementById(botId);
      if (bubble2 && rawAnswer) bubble2.innerHTML = _renderAgentMarkdown(rawAnswer);
    }
  }
  messages.scrollTop = messages.scrollHeight;
}
window.sendAgentMessage = sendAgentMessage;
