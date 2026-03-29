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

    /* Button micro-interactions */
    .btn-glow { background: linear-gradient(135deg, #4f46e5, #7c3aed); color:#fff; border:none;
      transition: all 0.22s ease; box-shadow: 0 2px 10px rgba(79,70,229,0.25); }
    .btn-glow:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(79,70,229,0.35); }
    .btn-glow:active { transform: translateY(0); box-shadow: 0 2px 6px rgba(79,70,229,0.2); }

    /* Toast notification */
    @keyframes toastIn { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }
    @keyframes toastOut { from { opacity:1; } to { opacity:0; transform:translateY(-8px); } }
    .ac-toast { position:fixed; bottom:24px; right:24px; padding:14px 22px; border-radius:14px;
      font-size:13px; font-weight:600; font-family:Inter,sans-serif; z-index:9999;
      display:flex; align-items:center; gap:10px; max-width:420px;
      animation: toastIn 0.35s ease-out, toastOut 0.35s ease 2.8s forwards;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15); }
    .ac-toast.success { background:#065f46; color:#6ffbbe; }
    .ac-toast.error { background:#7f1d1d; color:#fca5a5; }
    .ac-toast.info { background:#1e1b4b; color:#c7d2fe; }

    /* Confidence ring */
    .confidence-ring { position:relative; width:52px; height:52px; border-radius:50%;
      display:flex; align-items:center; justify-content:center; }
    .confidence-ring::before { content:''; position:absolute; inset:0; border-radius:50%;
      background: conic-gradient(var(--ring-color,#4f46e5) var(--ring-pct,0%), #e5e7eb var(--ring-pct,0%)); }
    .confidence-ring::after { content:''; position:absolute; inset:4px; border-radius:50%; background:#fff; }
    .confidence-ring span { position:relative; z-index:1; font-size:11px; font-weight:800; }

    /* Card hover lift */
    .card-hover { transition: transform 0.2s ease, box-shadow 0.2s ease; }
    .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.08); }

    /* Smooth modal */
    .modal-enter { animation: modalFadeIn 0.25s ease-out; }
    @keyframes modalFadeIn { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }
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

  aside.style.background = 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)';

  aside.innerHTML = `
    <div class="flex items-center gap-3 px-2 mb-8 mt-2">
      <img src="img/logo.png" alt="Assetcues" class="h-16 w-auto brightness-0 invert" />
    </div>
    <a href="upload.html" class="w-full py-2.5 mb-5 btn-glow rounded-lg font-headline font-bold text-xs flex items-center justify-center gap-1.5 no-underline">
      <span class="material-symbols-outlined text-lg">add</span>
      New Upload
    </a>
    <nav class="flex-1 space-y-1">
      ${nav.map(item => {
        const isActive = item.href === activePage;
        return `<a class="flex items-center gap-3 px-4 py-2.5 ${isActive
          ? 'bg-white/10 text-white shadow-sm backdrop-blur-sm'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
        } rounded-lg font-manrope text-sm font-medium transition-all no-underline" href="${item.href}">
          <span class="material-symbols-outlined" ${isActive ? 'style="font-variation-settings: \'FILL\' 1;"' : ''}>${item.icon}</span>
          <span>${item.label}</span>
          ${item.label === 'Review' && stats.pending > 0 ? `<span class="ml-auto text-[10px] font-bold bg-indigo-500 text-white px-1.5 py-0.5 rounded">${stats.pending}</span>` : ''}
        </a>`;
      }).join('')}
    </nav>
    <div class="mt-auto pt-4 space-y-1 border-t border-white/10">
      <button onclick="openSettings()" class="flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-slate-200 font-manrope text-sm font-medium w-full text-left transition-colors">
        <span class="material-symbols-outlined">settings</span>
        <span>Settings</span>
      </button>
      <button onclick="if(confirm('Clear all POC data?')){Storage.clearAll().then(()=>location.reload())}" class="flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-red-400 font-manrope text-sm font-medium w-full text-left transition-colors">
        <span class="material-symbols-outlined">delete_sweep</span>
        <span>Clear Data</span>
      </button>
    </div>
  `;
}

/* ── Top Bar ── */
function injectTopBar(title) {
  const header = document.getElementById('topbar');
  if (!header) return;
  header.innerHTML = `
    <div class="flex items-center gap-4">
      <button class="md:hidden p-2 text-on-surface-variant" onclick="document.getElementById('sidebar').classList.toggle('-translate-x-full')">
        <span class="material-symbols-outlined">menu</span>
      </button>
      <h2 class="font-headline font-bold text-2xl tracking-tight text-on-primary-fixed">${title}</h2>
    </div>
    <div class="flex items-center gap-4">
      <div id="connection-badge" class="flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full"></div>
      <button onclick="openSettings()" class="p-2 text-on-surface-variant hover:bg-slate-200/50 rounded-full transition-colors">
        <span class="material-symbols-outlined">settings</span>
      </button>
    </div>
  `;
  // Check connection
  checkConnection();
}

async function checkConnection() {
  const badge = document.getElementById('connection-badge');
  if (!badge) return;
  badge.innerHTML = '<span class="w-2 h-2 bg-outline rounded-full animate-pulse"></span> Checking...';
  badge.className = 'flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full bg-surface-container text-on-surface-variant';
  const health = await Api.checkHealth();
  if (health.ok) {
    badge.innerHTML = '<span class="w-2 h-2 bg-tertiary-fixed-dim rounded-full"></span> Backend Connected';
    badge.className = 'flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full bg-tertiary-fixed/20 text-on-tertiary-container';
  } else {
    badge.innerHTML = '<span class="w-2 h-2 bg-error rounded-full"></span> Backend Offline';
    badge.className = 'flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full bg-error-container text-error cursor-pointer';
    badge.onclick = openSettings;
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
    draft: '<span class="px-2.5 py-1 text-[10px] font-bold rounded bg-secondary-fixed/30 text-on-secondary-container uppercase">Draft</span>',
    approved: '<span class="px-2.5 py-1 text-[10px] font-bold rounded bg-tertiary-fixed/20 text-on-tertiary-container uppercase">✓ Verified</span>',
    rejected: '<span class="px-2.5 py-1 text-[10px] font-bold rounded bg-error-container text-error uppercase">Rejected</span>',
    in_review: '<span class="px-2.5 py-1 text-[10px] font-bold rounded bg-secondary-fixed/30 text-on-secondary-container uppercase">In Review</span>',
    verified: '<span class="px-2.5 py-1 text-[10px] font-bold rounded bg-tertiary-fixed/20 text-on-tertiary-container uppercase">✓ Verified</span>',
    retired: '<span class="px-2.5 py-1 text-[10px] font-bold rounded bg-surface-container text-on-surface-variant uppercase">Retired</span>',
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
  const color = pct >= 90 ? '#059669' : pct >= 70 ? '#4f46e5' : '#dc2626';
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
