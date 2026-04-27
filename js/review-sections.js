/**
 * Review Detail — Section Renderers
 * Generates HTML for each section of the extraction review page.
 */

function _lv(label, value, opts = {}) {
  if (!value || value === '-' || value === 'null' || value === '0') return '';
  const mono = opts.mono ? 'font-mono text-xs uppercase' : '';
  const masked = opts.mask ? ('••••' + String(value).slice(-4)) : value;
  const display = opts.currency ? formatCurrency(value) : masked;
  const tt = opts.truncate ? `title="${value}"` : '';
  const trunc = opts.truncate ? 'truncate max-w-[200px]' : '';
  return `<div class="space-y-0.5">
    <p class="text-[10px] text-on-surface-variant uppercase font-bold">${label}</p>
    <p class="text-sm font-medium text-on-surface ${mono} ${trunc}" ${tt}>${display}</p>
  </div>`;
}

function _sectionHeader(icon, title, badge) {
  const b = badge ? `<span class="bg-surface-container px-2 py-0.5 rounded text-[9px] text-on-surface-variant">${badge}</span>` : '';
  return `<h3 class="text-[10px] font-label uppercase tracking-widest text-outline mb-4 flex justify-between items-center">
    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-sm">${icon}</span> ${title}</span>${b}
  </h3>`;
}

function renderInvoiceHeaderSection(header) {
  const rows = [
    _lv('Invoice Number', header.inv_no, {mono:true}),
    _lv('Invoice Date', header.inv_dt),
    _lv('Invoice Type', header.inv_type),
    _lv('Copy Type', header.copy_type),
    _lv('PO Number', header.po_no, {mono:true}),
    _lv('PO Date', header.po_dt),
    _lv('Place of Supply', header.place_of_supply),
    _lv('Payment Terms', header.payment_terms),
    _lv('E-Way Bill', header.eway_bill_no, {mono:true}),
    _lv('IRN', header.irn, {mono:true, truncate:true}),
    _lv('Ack Number', header.ack_no, {mono:true}),
    _lv('Ack Date', header.ack_dt),
  ].filter(Boolean).join('');
  if (!rows) return '';
  return `<section>${_sectionHeader('receipt_long','Invoice Header')}<div class="grid grid-cols-2 md:grid-cols-3 gap-4 bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4">${rows}</div></section>`;
}

function renderVendorSection(vendor) {
  const rows = [
    _lv('Company Name', vendor.name),
    _lv('GSTIN', vendor.gstin, {mono:true}),
    _lv('PAN', vendor.pan, {mono:true}),
    _lv('State Code', vendor.state_code),
    _lv('CIN', vendor.cin, {mono:true}),
    _lv('Phone', vendor.tel),
    _lv('Email', vendor.email),
  ].filter(Boolean).join('');
  const addr = vendor.addr ? `<p class="text-xs text-on-surface-variant mt-2 bg-surface-container rounded p-2">${vendor.addr}</p>` : '';
  if (!rows && !addr) return '';
  return `<section>${_sectionHeader('storefront','Vendor / Seller')}<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4"><div class="grid grid-cols-2 md:grid-cols-3 gap-4">${rows}</div>${addr}</div></section>`;
}

function renderBuyerSection(buyer) {
  const rows = [
    _lv('Company Name', buyer.name),
    _lv('GSTIN', buyer.gstin, {mono:true}),
    _lv('PAN', buyer.pan, {mono:true}),
    _lv('State', buyer.state),
    _lv('State Code', buyer.state_code),
    _lv('Contact', buyer.contact),
    _lv('Mobile', buyer.mobile),
  ].filter(Boolean).join('');
  const addr = buyer.addr ? `<p class="text-xs text-on-surface-variant mt-2 bg-surface-container rounded p-2">${buyer.addr}</p>` : '';
  if (!rows && !addr) return '';
  return `<section>${_sectionHeader('business','Buyer / Bill-To')}<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4"><div class="grid grid-cols-2 md:grid-cols-3 gap-4">${rows}</div>${addr}</div></section>`;
}

function renderShipToSection(shipTo) {
  const hasData = Object.values(shipTo).some(v => v && v !== '-');
  if (!hasData) return '';
  const rows = [
    _lv('Company Name', shipTo.name),
    _lv('GSTIN', shipTo.gstin, {mono:true}),
    _lv('PAN', shipTo.pan, {mono:true}),
    _lv('State', shipTo.state),
    _lv('State Code', shipTo.state_code),
    _lv('Contact', shipTo.contact),
    _lv('Mobile', shipTo.mobile),
  ].filter(Boolean).join('');
  const addr = shipTo.addr ? `<p class="text-xs text-on-surface-variant mt-2 bg-surface-container rounded p-2">${shipTo.addr}</p>` : '';
  return `<section>${_sectionHeader('local_shipping','Ship-To')}<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4"><div class="grid grid-cols-2 md:grid-cols-3 gap-4">${rows}</div>${addr}</div></section>`;
}

function renderLineItemsSection(lineItems, confidence) {
  if (!lineItems || lineItems.length === 0) return `<section>${_sectionHeader('list_alt','Line Items','0 Items')}<p class="text-xs text-on-surface-variant text-center py-4 bg-surface-container-lowest border border-dashed rounded-lg">No line items detected.</p></section>`;

  const rows = lineItems.map((li, i) => {
    const desc = li.description || ('Item ' + (i+1));
    const serials = li.serial_no ? li.serial_no.split(',').map(s => s.trim()).filter(Boolean) : [];
    const serialHtml = serials.length > 0
      ? `<div class="flex flex-wrap gap-1 mt-1.5">${serials.map(s => `<span class="text-[9px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">${s}</span>`).join('')}</div>`
      : '';
    const partHtml = li.part_no ? `<span class="text-[9px] font-mono bg-surface-container px-1.5 py-0.5 rounded mt-1 inline-block">${li.part_no}</span>` : '';

    // Tax chips — render rate AND amount whenever either is present.
    const _chip = (label, rate, amt, cls) => {
      const r = parseNum(rate), a = parseNum(amt);
      if (r <= 0 && a <= 0) return '';
      const rateLbl = r > 0 ? ` ${rate}%` : '';
      const amtLbl  = a > 0 ? ` = ${formatCurrency(amt)}` : '';
      return `<span class="text-[9px] ${cls} px-1.5 py-0.5 rounded">${label}${rateLbl}${amtLbl}</span>`;
    };
    let taxChips = '';
    taxChips += _chip('IGST', li.igst_rate, li.igst_amt, 'bg-blue-50 text-blue-700');
    taxChips += _chip('CGST', li.cgst_rate, li.cgst_amt, 'bg-green-50 text-green-700');
    taxChips += _chip('SGST', li.sgst_rate, li.sgst_amt, 'bg-yellow-50 text-yellow-700');

    const lineTotal = li.total_amt || li.amt || '';

    return `<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 hover:border-outline-variant transition-colors">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-bold text-on-surface">${li.sr_no ? '#'+li.sr_no+' ' : ''}${desc}</p>
          ${partHtml}${serialHtml}
        </div>
        <div class="text-right shrink-0">
          <span class="text-sm font-bold font-mono text-on-surface">${formatCurrency(lineTotal)}</span>
          ${taxChips ? `<div class="flex flex-wrap gap-1 mt-1 justify-end">${taxChips}</div>` : ''}
        </div>
      </div>
      <div class="grid grid-cols-5 gap-2 text-[11px] mt-2 pt-2 border-t border-outline-variant/20">
        <div><span class="text-on-surface-variant block mb-0.5">HSN/SAC</span><span class="font-mono font-bold text-primary">${li.hsn || '—'}</span></div>
        <div><span class="text-on-surface-variant block mb-0.5">Qty</span><span class="font-bold">${li.qty || 1} ${li.uom || ''}</span></div>
        <div><span class="text-on-surface-variant block mb-0.5">Rate</span><span class="font-bold">${formatCurrency(li.rate)}</span></div>
        <div><span class="text-on-surface-variant block mb-0.5">Taxable Amt</span><span class="font-bold">${formatCurrency(li.amt)}</span></div>
        <div><span class="text-on-surface-variant block mb-0.5">Total</span><span class="font-bold font-mono">${formatCurrency(lineTotal)}</span></div>
      </div>
    </div>`;
  }).join('');

  return `<section>${_sectionHeader('list_alt','Line Items & Taxes', lineItems.length + ' Extracted')}<div class="space-y-2">${rows}</div></section>`;
}

function renderFinancialsSection(totals) {
  const taxRows = [];
  if (totals.cgst_amt) taxRows.push(`<div class="flex justify-between text-sm"><span class="text-on-surface-variant">CGST ${totals.cgst_rate||''}</span><span class="font-mono font-bold">${formatCurrency(totals.cgst_amt)}</span></div>`);
  if (totals.sgst_amt) taxRows.push(`<div class="flex justify-between text-sm"><span class="text-on-surface-variant">SGST ${totals.sgst_rate||''}</span><span class="font-mono font-bold">${formatCurrency(totals.sgst_amt)}</span></div>`);
  if (totals.igst_amt) taxRows.push(`<div class="flex justify-between text-sm"><span class="text-on-surface-variant">IGST ${totals.igst_rate||''}</span><span class="font-mono font-bold">${formatCurrency(totals.igst_amt)}</span></div>`);

  const totalTax = parseNum(totals.cgst_amt) + parseNum(totals.sgst_amt) + parseNum(totals.igst_amt);
  const roundRow = totals.rounding ? `<div class="flex justify-between text-sm"><span class="text-on-surface-variant">Rounding</span><span class="font-mono font-bold">${totals.rounding}</span></div>` : '';
  const wordsRow = totals.amt_in_words ? `<p class="text-[11px] text-on-surface-variant italic mt-2 pt-2 border-t border-outline-variant/20">${totals.amt_in_words}</p>` : '';
  const dueRow = totals.due_dt ? `<div class="flex justify-between text-sm mt-2"><span class="text-on-surface-variant">Due Date</span><span class="font-bold">${totals.due_dt}</span></div>` : '';
  const creditRow = totals.credit_days ? `<div class="flex justify-between text-sm"><span class="text-on-surface-variant">Credit Period</span><span class="font-bold">${totals.credit_days} days</span></div>` : '';
  const sigRow = totals.authorized_signatory ? `<p class="text-[10px] text-on-surface-variant mt-2 pt-2 border-t border-outline-variant/20">Signatory: ${totals.authorized_signatory}</p>` : '';

  return `<section>${_sectionHeader('account_balance','Financials & Validation')}
    <div class="bg-surface-container-low rounded-xl p-5 border border-surface-container space-y-2">
      <div class="flex justify-between text-sm"><span class="text-on-surface-variant">Subtotal (Taxable)</span><span class="font-bold font-mono">${formatCurrency(totals.subtotal)}</span></div>
      ${taxRows.join('')}
      <div class="flex justify-between text-sm font-bold border-t border-outline-variant/30 pt-2"><span class="text-on-surface-variant">Total Tax</span><span class="font-mono">${formatCurrency(totalTax)}</span></div>
      ${roundRow}
      <div class="flex justify-between items-center pt-3 border-t-2 border-primary/20 mt-2">
        <span class="text-sm font-black uppercase text-on-surface">Grand Total</span>
        <span class="font-mono text-lg font-black text-on-surface">${formatCurrency(totals.grand_total)}</span>
      </div>
      ${wordsRow}${dueRow}${creditRow}${sigRow}
    </div>
  </section>`;
}

function renderLogisticsSection(logistics, bank) {
  const logRows = [
    _lv('Transporter', logistics.transporter),
    _lv('Vehicle No', logistics.vehicle_no, {mono:true}),
    _lv('Dispatch From', logistics.dispatch_from),
    _lv('Dispatch To', logistics.dispatch_to),
    _lv('Mode', logistics.dispatch_mode),
    _lv('LR No', logistics.lr_no, {mono:true}),
    _lv('LR Date', logistics.lr_dt),
    _lv('Sales Person', logistics.sales_person),
    _lv('Sales Order', logistics.sales_order_no, {mono:true}),
  ].filter(Boolean).join('');

  const bankRows = [
    _lv('Bank Name', bank.name),
    _lv('Account No', bank.acct, {mask:true}),
    _lv('IFSC', bank.ifsc, {mono:true}),
    _lv('Branch', bank.branch),
    _lv('SWIFT', bank.swift, {mono:true}),
    _lv('MICR', bank.micr, {mono:true}),
  ].filter(Boolean).join('');

  if (!logRows && !bankRows) return '';

  let html = `<section>${_sectionHeader('local_shipping','Logistics & Payment')}`;
  if (logRows) html += `<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 mb-3"><div class="grid grid-cols-2 md:grid-cols-3 gap-4">${logRows}</div></div>`;
  if (bankRows) html += `<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4"><p class="text-[10px] text-on-surface-variant uppercase font-bold mb-3">Bank Details</p><div class="grid grid-cols-2 md:grid-cols-3 gap-4">${bankRows}</div></div>`;
  html += `</section>`;
  return html;
}

function renderProcessingSection(meta) {
  if (!meta || !meta.provider) return '';
  const timeStr = meta.processing_time_ms ? (meta.processing_time_ms / 1000).toFixed(1) + 's' : '—';
  return `<section>
    ${_sectionHeader('smart_toy','Processing Metadata')}
    <div class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4">
      <div class="grid grid-cols-3 md:grid-cols-4 gap-3 text-[11px]">
        <div><span class="text-on-surface-variant block">Provider</span><span class="font-bold">${meta.provider || '—'}</span></div>
        <div><span class="text-on-surface-variant block">Model</span><span class="font-bold font-mono text-[10px]">${meta.model || '—'}</span></div>
        <div><span class="text-on-surface-variant block">Pages</span><span class="font-bold">${meta.page_count || '—'}</span></div>
        <div><span class="text-on-surface-variant block">Time</span><span class="font-bold">${timeStr}</span></div>
        <div><span class="text-on-surface-variant block">Thinking</span><span class="font-bold">${meta.thinking_level || '—'}</span></div>
        <div><span class="text-on-surface-variant block">Resolution</span><span class="font-bold">${meta.media_resolution || '—'}</span></div>
        <div><span class="text-on-surface-variant block">Input Tokens</span><span class="font-bold font-mono">${(meta.input_tokens||0).toLocaleString()}</span></div>
        <div><span class="text-on-surface-variant block">Output Tokens</span><span class="font-bold font-mono">${(meta.output_tokens||0).toLocaleString()}</span></div>
      </div>
    </div>
  </section>`;
}
