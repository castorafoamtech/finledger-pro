/* FinLedger Pro — fin_app.js  v2
   Full spreadsheet keyboard nav · fixed Ctrl+Z · sidebar search nav · search button
*/
'use strict';

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

const fmt = (n, decimals = 2) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return n < 0 ? `(${s})` : s;
};

const fmtDate      = d => (!d ? '' : String(d).slice(0, 10));
const fmtDateShort = d => {
  if (!d) return '';
  const [, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}`;
};

const el  = sel => document.querySelector(sel);
const els = sel => [...document.querySelectorAll(sel)];

const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

function toast(msg, type = 'info', ms = 2800) {
  const c = el('#toast-container');
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  div.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
  c.appendChild(div);
  setTimeout(() => div.remove(), ms);
}

const $ = {
  async get(url)       { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); },
  async post(url, b)   { const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(r.status); return r.json(); },
  async put(url, b)    { const r = await fetch(url, { method:'PUT',  headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(r.status); return r.json(); },
  async del(url)       { const r = await fetch(url, { method:'DELETE' }); if (!r.ok) throw new Error(r.status); return r.json(); },
};

// Editable column order in the ledger
const EDITABLE_COLS = ['txn_date', 'credit', 'credit_remark', 'debit', 'debit_remark'];


// ═══════════════════════════════════════════════════════════════
// UNDO MANAGER  (fixed — no race condition)
// ═══════════════════════════════════════════════════════════════

class UndoManager {
  constructor() { this.undo = []; this.redo = []; this.max = 80; }

  push(action) {
    this.undo.push(action);
    this.redo = [];
    if (this.undo.length > this.max) this.undo.shift();
    this._flash(action.label);
  }

  async doUndo(app) {
    const a = this.undo.pop();
    if (!a) { toast('Nothing to undo', 'info', 1500); return; }
    this.redo.push(a);
    await a.undo(app);
    toast(`Undone: ${a.label}`, 'info', 1800);
  }

  async doRedo(app) {
    const a = this.redo.pop();
    if (!a) { toast('Nothing to redo', 'info', 1500); return; }
    this.undo.push(a);
    await a.redo(app);
    toast(`Redone: ${a.label}`, 'info', 1800);
  }

  _flash(label) {
    const bar = el('#undo-bar');
    el('#undo-bar-label').textContent = label || 'action';
    bar.classList.add('visible');
    clearTimeout(this._t);
    this._t = setTimeout(() => bar.classList.remove('visible'), 4500);
  }

  get canUndo() { return this.undo.length > 0; }
}


// ═══════════════════════════════════════════════════════════════
// AUTOCOMPLETE
// ═══════════════════════════════════════════════════════════════

class Autocomplete {
  constructor() {
    this.drop  = el('#autocomplete-dropdown');
    this.items = [];
    this.idx   = -1;
    this.inp   = null;
    this._cache = {};
    document.addEventListener('click', e => { if (!this.drop.contains(e.target)) this.hide(); });
    document.addEventListener('keydown', e => {
      if (!this.drop.classList.contains('open')) return;
      if (e.key === 'ArrowDown')  { e.preventDefault(); this._mv(1); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); this._mv(-1); }
      if (e.key === 'Enter' && this.idx >= 0) { e.preventDefault(); this._sel(this.idx); }
      if (e.key === 'Escape')     { this.hide(); }
    });
  }

  async show(inputEl, q) {
    this.inp = inputEl;
    if (!q) { this.hide(); return; }
    const key = q.toLowerCase();
    if (!this._cache[key]) {
      try { this._cache[key] = await $.get(`/api/autocomplete?q=${encodeURIComponent(q)}`); }
      catch { return; }
    }
    this.items = this._cache[key];
    if (!this.items.length) { this.hide(); return; }
    const rect = inputEl.getBoundingClientRect();
    Object.assign(this.drop.style, {
      top: `${rect.bottom + 2}px`, left: `${rect.left}px`,
      width: `${Math.max(rect.width, 200)}px`,
    });
    this.drop.innerHTML = this.items.map((item, i) =>
      `<div class="autocomplete-item" data-i="${i}">${this._hl(item, q)}</div>`
    ).join('');
    this.drop.querySelectorAll('.autocomplete-item').forEach((d, i) =>
      d.addEventListener('mousedown', e => { e.preventDefault(); this._sel(i); })
    );
    this.drop.classList.add('open');
    this.idx = -1;
  }

  _hl(text, q) {
    return text.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark class="highlight">$1</mark>');
  }

  _mv(d) {
    this.idx = Math.max(-1, Math.min(this.items.length - 1, this.idx + d));
    this.drop.querySelectorAll('.autocomplete-item').forEach((el, i) => el.classList.toggle('selected', i === this.idx));
  }

  _sel(i) {
    if (this.inp && this.items[i] != null) {
      this.inp.value = this.items[i];
      this.inp.dispatchEvent(new Event('input', { bubbles: true }));
      this.inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.hide();
  }

  hide() { this.drop.classList.remove('open'); this.idx = -1; }
  invalidate() { this._cache = {}; }
}


// ═══════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════

class SearchEngine {
  constructor(app) {
    this.app     = app;
    this.overlay = el('#search-overlay');
    this.input   = el('#search-input');
    this.results = el('#search-results');
    this.items   = [];
    this.focused = -1;

    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.close(); });
    this.input.addEventListener('input',   debounce(() => this._search(), 180));
    this.input.addEventListener('keydown', e => this._key(e));

    // Tab navigation inside modal
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const n = this.items.length;
        if (!n) return;
        this.focused = e.shiftKey ? (this.focused - 1 + n) % n : (this.focused + 1) % n;
        this._hilite();
      }
    });
  }

  open(mode) {
    this.overlay.classList.add('open');
    // Update placeholder by mode
    const ph = mode === 'date' ? 'Search by date (e.g. 2025-04)…'
             : mode === 'account' ? 'Search account name or number…'
             : 'Search accounts, entries, amounts…';
    this.input.placeholder = ph;
    this._mode = mode || 'all';
    setTimeout(() => { this.input.focus(); this.input.select(); }, 40);
  }

  close() {
    this.overlay.classList.remove('open');
    this.input.value = '';
    this.results.innerHTML = '<div class="search-no-results">Start typing to search…</div>';
    this.items = [];
    this.focused = -1;
    this._mode = 'all';
  }

  async _search() {
    const q = this.input.value.trim();
    if (!q) { this.results.innerHTML = '<div class="search-no-results">Start typing…</div>'; return; }
    try {
      const url = `/api/search?q=${encodeURIComponent(q)}&limit=120`;
      const data = await $.get(url);
      this.items = data.results;
      this._render(q);
    } catch {
      this.results.innerHTML = '<div class="search-no-results">Error — try again</div>';
    }
  }

  _render(q) {
    if (!this.items.length) {
      this.results.innerHTML = `<div class="search-no-results">No results for <strong>"${q}"</strong></div>`;
      return;
    }
    this.results.innerHTML = this.items.map((item, i) => {
      const isAcct = item.type === 'account';
      const iconCls = isAcct ? 'account' : (item.amount >= 0 ? 'transaction' : 'debit-txn');
      const iconTxt = isAcct ? '📂' : (item.amount >= 0 ? '↑' : '↓');
      const amt = item.amount != null
        ? `<span class="search-result-amount ${item.amount >= 0 ? 'pos' : 'neg'}">${fmt(Math.abs(item.amount))}</span>` : '';
      return `<div class="search-result-item" data-i="${i}">
        <div class="search-result-icon ${iconCls}">${iconTxt}</div>
        <div class="search-result-body">
          <div class="search-result-title">${this._hl(item.title || '', q)}</div>
          <div class="search-result-sub">${item.subtitle || ''} ${item.date ? '· ' + item.date : ''}</div>
        </div>${amt}</div>`;
    }).join('');
    this.results.querySelectorAll('.search-result-item').forEach((d, i) =>
      d.addEventListener('click', () => this._goto(i))
    );
    this.focused = -1;
  }

  _hl(t, q) {
    return t.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark class="highlight">$1</mark>');
  }

  _goto(i) {
    const item = this.items[i];
    if (!item) return;
    this.close();
    this.app.openAccount(item.account_id);
    if (item.txn_id) setTimeout(() => this.app.scrollToTxn(item.txn_id), 420);
  }

  _key(e) {
    const n = this.items.length;
    if (!n) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.focused = (this.focused + 1) % n; this._hilite(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); this.focused = (this.focused - 1 + n) % n; this._hilite(); }
    if (e.key === 'Enter' && this.focused >= 0) { this._goto(this.focused); }
    if (e.key === 'Escape') { this.close(); }
  }

  _hilite() {
    this.results.querySelectorAll('.search-result-item').forEach((d, i) => {
      d.classList.toggle('focused', i === this.focused);
      if (i === this.focused) d.scrollIntoView({ block: 'nearest' });
    });
  }
}


// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════

class FinApp {
  constructor() {
    this.accounts          = [];
    this.currentAccountId  = null;
    this.ledgerData        = null;
    this.transactions      = [];
    this.filters           = { type: 'all', status: '', color_flag: '', date_from: '', date_to: '', q: '' };
    this.sortField         = 'txn_date';
    this.sortDir           = null;  // null = server order, 'asc' = oldest first, 'desc' = newest first
    this.lastUsedDate      = localStorage.getItem('fin_last_date')     || null;
    this.lastUsedTxnDate   = localStorage.getItem('fin_last_txn_date') || null;
    this._sessionStart     = Date.now();
    this.selectedRows      = new Set();
    this.undoMgr           = new UndoManager();
    this.autocomplete      = new Autocomplete();
    this.search            = new SearchEngine(this);

    // Keyboard navigation state
    this.navPos            = null; // { txnId, field } — cell currently highlighted (nav mode)
    this.inEdit            = false; // true when an input is open

    this._init();
  }

  async _init() {
    this._setupGlobalKeys();
    this._setupSidebarSearch();
    this._setupContextMenu();
    this._setupModals();
    this._setupFAB();
    this._setupTValue();
    this._setupPreviousValue();
    this._setupUpdatedTill();
    this._setupUndoBar();
    this._setupSearchButtons();
    this._setupMobileNav();
    this._setupSort();
    await Promise.all([this.loadAccounts(), this.refreshKPIs()]);
  }

  // ── Search buttons ────────────────────────────────────────────

  _setupSearchButtons() {
    // All three search triggers open the global search modal
    el('#search-btn-main')?.addEventListener('click',    () => this.search.open('all'));
    el('#search-btn-acct')?.addEventListener('click',    () => this.search.open('account'));
    el('#search-btn-date')?.addEventListener('click',    () => this.search.open('date'));
    el('#search-btn-header')?.addEventListener('click',  () => this.search.open('all'));
  }

  // ── Date helpers ──────────────────────────────────────────────

  _defaultDate() {
    if (this.lastUsedDate) return this.lastUsedDate;
    // Fall back to the last transaction's date in the current ledger
    if (this.transactions.length) {
      const d = this.transactions[this.transactions.length - 1].txn_date;
      if (d) return String(d).slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  }

  // ── Column Sort ───────────────────────────────────────────────

  _setupSort() {
    document.querySelectorAll('.th-sortable[data-sort]').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const field = hdr.dataset.sort;
        if (this.sortField !== field || this.sortDir === null) {
          this.sortField = field;
          this.sortDir   = 'asc';
        } else if (this.sortDir === 'asc') {
          this.sortDir = 'desc';
        } else {
          this.sortDir = null;
        }
        this._renderLedger();
      });
    });
  }

  // ── Mobile Nav ────────────────────────────────────────────────

  _setupMobileNav() {
    const sidebar  = el('#sidebar');
    const backdrop = el('#sidebar-backdrop');

    const openDrawer = () => {
      sidebar.classList.add('drawer-open');
      backdrop.classList.add('open');
    };
    const closeDrawer = () => {
      sidebar.classList.remove('drawer-open');
      backdrop.classList.remove('open');
    };
    const toggleDrawer = () =>
      sidebar.classList.contains('drawer-open') ? closeDrawer() : openDrawer();

    el('#mob-accounts-btn')?.addEventListener('click', toggleDrawer);
    backdrop.addEventListener('click', closeDrawer);

    el('#mob-search-btn')?.addEventListener('click', () => {
      closeDrawer();
      this.search.open('all');
    });

    el('#mob-add-btn')?.addEventListener('click', () => {
      closeDrawer();
      this.openQuickAdd();
    });

    el('#mob-summary-btn')?.addEventListener('click', () => {
      closeDrawer();
      this.openSummary();
    });

    el('#mob-kpi-btn')?.addEventListener('click', () => {
      closeDrawer();
      el('#kpi-bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Close drawer when an account is opened on mobile
    const origOpenAccount = this.openAccount.bind(this);
    this.openAccount = (id) => {
      closeDrawer();
      return origOpenAccount(id);
    };
  }

  // ── Accounts ─────────────────────────────────────────────────

  async loadAccounts() {
    try {
      this.accounts = await $.get('/api/accounts');
      this._renderAccountList();
    } catch { toast('Failed to load accounts', 'error'); }
  }

  _renderAccountList() {
    const container = el('#account-list');
    const filterQ   = (el('#sidebar-search-input').value || '').toLowerCase();

    const filtered = this.accounts.filter(a =>
      !filterQ || a.name.toLowerCase().includes(filterQ) || (a.number||'').toLowerCase().includes(filterQ)
    );

    const pinned   = filtered.filter(a => a.is_pinned);
    const hGroup   = filtered.filter(a => !a.is_pinned && a.group_type === 'H');
    const dGroup   = filtered.filter(a => !a.is_pinned && a.group_type === 'dolph');
    const regular  = filtered.filter(a => !a.is_pinned && a.group_type === 'regular');

    let html = '';
    if (pinned.length)  { html += `<div class="nav-section-label">Pinned</div>` + pinned.map(a => this._acctItemHTML(a)).join(''); }
    if (hGroup.length)  { html += `<div class="nav-section-label"><span>H Accounts</span></div>` + hGroup.map(a => this._acctItemHTML(a)).join(''); }
    if (dGroup.length)  { html += `<div class="nav-section-label"><span>Dolph Accounts</span></div>` + dGroup.map(a => this._acctItemHTML(a)).join(''); }
    html += `<div class="nav-section-label"><span>All Accounts</span><button class="add-btn" id="add-acct-inline" title="Add">+</button></div>`;
    html += regular.map(a => this._acctItemHTML(a)).join('');

    container.innerHTML = html;

    // Events
    container.querySelectorAll('.account-item').forEach(item => {
      const id = parseInt(item.dataset.id);
      item.setAttribute('tabindex', '0');
      item.addEventListener('click',     () => this.openAccount(id));
      item.addEventListener('keydown',   e  => this._acctItemKey(e, id, item));
      item.addEventListener('contextmenu', e => { e.preventDefault(); this._showAccountCtxMenu(e, id); });
    });

    el('#add-acct-inline')?.addEventListener('click', () => this.showAddAccountModal());
  }

  // Keyboard navigation within account list items
  _acctItemKey(e, id, item) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.openAccount(id);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = item.nextElementSibling;
      if (next && next.classList.contains('account-item')) next.focus();
      else {
        // Skip section labels
        let sib = item.nextElementSibling;
        while (sib && !sib.classList.contains('account-item')) sib = sib.nextElementSibling;
        if (sib) sib.focus();
      }
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      let sib = item.previousElementSibling;
      while (sib && !sib.classList.contains('account-item')) sib = sib.previousElementSibling;
      if (sib) sib.focus();
      else el('#sidebar-search-input').focus();
    }
    if (e.key === 'Escape') {
      el('#sidebar-search-input').focus();
    }
  }

  _acctItemHTML(a) {
    const active   = a.id === this.currentAccountId ? 'active' : '';
    const bal      = a.balance || 0;
    const balStr   = fmt(Math.abs(bal), 0);
    const pinIcon  = a.is_pinned ? '★' : '☆';
    const pinTitle = a.is_pinned ? 'Unpin account' : 'Pin to top';
    const pinClass = a.is_pinned ? 'acct-pin-btn pinned' : 'acct-pin-btn';
    const grp      = a.group_type !== 'regular'
      ? `<span class="account-item-group ${a.group_type}">${a.group_type.toUpperCase()}</span>` : '';
    return `<div class="account-item ${active}" data-id="${a.id}" tabindex="0" role="button">
      <span class="account-dot ${a.group_type}" style="${a.color ? 'background:' + a.color : ''}"></span>
      <span class="account-item-name">${a.name}</span>
      ${grp}
      <span class="account-item-badge">${balStr}</span>
      <button class="${pinClass}" title="${pinTitle}" onclick="event.stopPropagation();window.finApp.togglePin(${a.id})">${pinIcon}</button>
      <button class="acct-edit-btn" title="Edit account" onclick="event.stopPropagation();window.finApp.showAddAccountModal(window.finApp.accounts.find(x=>x.id===${a.id}))">✏</button>
    </div>`;
  }

  // ── Open Account ──────────────────────────────────────────────

  async openAccount(id) {
    this.currentAccountId = id;
    this.navPos = null;
    el('#welcome-state')?.remove();
    this._markActive(id);
    for (const s of ['#top-header','#kpi-bar','#filter-bar','#ledger-footer','#ledger-wrap','#fab'])
      el(s)?.classList.remove('hidden');
    this._showSkeleton();
    await this.loadLedger();
  }

  _markActive(id) {
    els('.account-item').forEach(item =>
      item.classList.toggle('active', parseInt(item.dataset.id) === id)
    );
  }

  _showSkeleton() {
    el('#ledger-tbody').innerHTML = Array(6).fill(0).map(() =>
      `<tr class="ledger-row"><td colspan="10"><div style="height:33px;margin:3px 10px" class="skeleton"></div></td></tr>`
    ).join('');
  }

  async loadLedger() {
    if (!this.currentAccountId) return;
    const p = new URLSearchParams({
      type: this.filters.type || 'all',
      ...(this.filters.status     && { status:     this.filters.status }),
      ...(this.filters.color_flag && { color_flag: this.filters.color_flag }),
      ...(this.filters.date_from  && { date_from:  this.filters.date_from }),
      ...(this.filters.date_to    && { date_to:    this.filters.date_to }),
      ...(this.filters.q          && { q:          this.filters.q }),
    });
    try {
      this.ledgerData   = await $.get(`/api/accounts/${this.currentAccountId}/ledger?${p}`);
      this.transactions = this.ledgerData.transactions;
      this._renderHeader();
      this._renderLedger();
      this._renderFooter();
    } catch { toast('Failed to load ledger', 'error'); }
  }

  _renderHeader() {
    const a = this.ledgerData.account;
    el('#header-account-name').textContent = a.name;
    el('#header-account-sub').textContent  = a.number ? `#${a.number}` : '';
    const balEl = el('#header-balance');
    balEl.textContent = fmt(a.balance);
    balEl.className   = `text-mono${a.balance < 0 ? ' text-red' : ''}`;
    el('#header-credits').textContent = fmt(a.total_credits);
    el('#header-debits').textContent  = fmt(a.total_debits);
  }

  _renderLedger() {
    const tbody = el('#ledger-tbody');

    // Apply sort — keep this.transactions in server order; work on a display copy
    let txns = this.transactions;
    if (this.sortField && this.sortDir) {
      txns = [...txns].sort((a, b) => {
        const va = a[this.sortField] || '';
        const vb = b[this.sortField] || '';
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return this.sortDir === 'asc' ? cmp : -cmp;
      });
      // Recompute running balance in display order so the balance column is correct
      let r = 0;
      txns.forEach(t => {
        r = Math.round((r + (t.credit || 0) - (t.debit || 0)) * 1e6) / 1e6;
        t.running_balance = r;
      });
    }

    // Update sort icon
    const iconEl = document.querySelector(`.th-sortable[data-sort="${this.sortField}"] .th-sort-icon`);
    if (iconEl) {
      if (!this.sortDir) { iconEl.textContent = '↕'; iconEl.classList.remove('active'); }
      else { iconEl.textContent = this.sortDir === 'asc' ? '↑' : '↓'; iconEl.classList.add('active'); }
    }

    if (!txns.length) {
      tbody.innerHTML = `<tr><td colspan="10">
        <div class="ledger-empty">
          <div class="icon">📋</div>
          <h3>No transactions</h3>
          <p>Press <kbd>Shift+N</kbd> or click ＋ Add Entry</p>
        </div></td></tr>`;
      return;
    }

    tbody.innerHTML = txns.map((t, i) => this._rowHTML(t, i)).join('');

    // Add-row at bottom
    const addRow = document.createElement('tr');
    addRow.className = 'ledger-add-row ledger-row';
    addRow.innerHTML = `<td colspan="10"><div class="cell-inner">
      <button class="add-row-btn" id="inline-add-row-btn">
        <span style="font-size:16px;font-weight:300">＋</span>
        <span>Add entry</span>
        <span style="font-size:11px;color:var(--text-muted);margin-left:6px">Shift+N</span>
      </button></div></td>`;
    tbody.appendChild(addRow);
    el('#inline-add-row-btn').addEventListener('click', () => this.quickAddRow());

    tbody.querySelectorAll('.ledger-row[data-txn-id]').forEach(row => this._attachRowEvents(row));
    this._attachCheckboxEvents();
    this.selectedRows.clear();
    this._updateSelectionToolbar();

    // Restore nav focus if any
    if (this.navPos) this._applyNavFocus(this.navPos.txnId, this.navPos.field);
  }

  _rowHTML(t, idx) {
    const flagCls = t.color_flag ? `flag-${t.color_flag}` : '';
    const selCls  = this.selectedRows.has(t.id) ? 'selected' : '';
    const bal     = t.running_balance;
    const balCls  = bal >= 0 ? 'positive' : 'negative';
    return `<tr class="ledger-row ${flagCls} ${selCls}" data-txn-id="${t.id}" data-idx="${idx}">
      <td class="col-sel">
        <div class="cell-check">
          <input type="checkbox" class="row-checkbox" data-id="${t.id}" ${this.selectedRows.has(t.id) ? 'checked' : ''}>
        </div>
      </td>
      <td class="col-date cell-editable cell-date" data-field="txn_date" data-id="${t.id}">
        <div class="cell-inner cell-date-inner">
          <input type="date" class="cell-input" value="${fmtDate(t.txn_date)}" data-id="${t.id}" data-field="txn_date">
          ${t.transaction_date ? `<span class="txn-date-sub" title="Date of Transaction">Txn: ${fmtDateShort(t.transaction_date)}</span>` : ''}
        </div>
      </td>
      <td class="col-credit cell-editable cell-num" data-field="credit" data-id="${t.id}">
        <div class="cell-inner">
          ${t.credit > 0 ? `<span class="amount-text">${fmt(t.credit)}</span>` : `<span class="text-muted" style="font-size:11px">—</span>`}
        </div>
      </td>
      <td class="col-cr-rem cell-editable" data-field="credit_remark" data-id="${t.id}">
        <div class="cell-inner"><span class="cell-text truncate" style="max-width:200px">${t.credit_remark || ''}</span></div>
      </td>
      <td class="col-debit cell-editable cell-num" data-field="debit" data-id="${t.id}">
        <div class="cell-inner">
          ${t.debit > 0 ? `<span class="amount-text">${fmt(t.debit)}</span>` : `<span class="text-muted" style="font-size:11px">—</span>`}
        </div>
      </td>
      <td class="col-dr-rem cell-editable" data-field="debit_remark" data-id="${t.id}">
        <div class="cell-inner"><span class="cell-text truncate" style="max-width:200px">${t.debit_remark || ''}</span></div>
      </td>
      <td class="col-balance cell-balance ${balCls}">
        <div class="cell-inner" style="justify-content:flex-end">
          <span class="text-mono" style="font-size:12px">${fmt(bal)}</span>
        </div>
      </td>
      <td class="col-status" data-id="${t.id}">
        <div class="cell-inner">
          <span class="status-badge status-${t.status}" data-id="${t.id}"
            onclick="window.finApp.cycleStatus(${t.id},this)">${t.status}</span>
        </div>
      </td>
      <td class="col-flag">
        <div class="cell-inner" style="justify-content:center">
          <span class="color-flag-dot flag-${t.color_flag||'none'}" data-id="${t.id}"
            onclick="window.finApp.cycleFlag(${t.id},this)"></span>
        </div>
      </td>
      <td class="col-actions">
        <div class="cell-inner row-actions">
          <button class="row-action-btn del" title="Delete" onclick="window.finApp.deleteTxn(${t.id})">✕</button>
          <button class="row-action-btn" title="Notes" onclick="window.finApp.openNotes(${t.id})">📝</button>
        </div>
      </td>
    </tr>`;
  }

  _attachRowEvents(row) {
    const id = parseInt(row.dataset.txnId);

    // Date cell — change event
    const dateInput = row.querySelector('input[type=date]');
    if (dateInput) {
      dateInput.addEventListener('change', async () => {
        if (dateInput.value) { this.lastUsedDate = dateInput.value; localStorage.setItem('fin_last_date', dateInput.value); }
        const before = { txn_date: this.transactions.find(t => t.id === id)?.txn_date || null };
        await this._patchTxn(id, { txn_date: dateInput.value });
        this.undoMgr.push({
          label: 'Edit date',
          undo: async app => { await app._patchTxn(id, before); await app.loadLedger(); },
          redo: async app => { await app._patchTxn(id, { txn_date: dateInput.value }); await app.loadLedger(); },
        });
      });
    }

    // Editable cells (except date)
    row.querySelectorAll('.cell-editable:not(.cell-date)').forEach(cell => {
      cell.addEventListener('click', e => {
        if (e.target.classList.contains('cell-input')) return;
        this._setNavFocus(id, cell.dataset.field);
        this._startEdit(cell, id, cell.dataset.field);
      });

      // Nav-mode click (click on nav-focused cell → enter edit)
      cell.addEventListener('dblclick', e => {
        this._startEdit(cell, id, cell.dataset.field);
      });
    });

    // Row right-click
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      this._showTxnCtxMenu(e, id);
    });

    // Click on row → set nav focus without editing
    row.addEventListener('mousedown', e => {
      const cell = e.target.closest('.cell-editable:not(.cell-date)');
      if (!cell) return;
      if (!this.inEdit) this._setNavFocus(id, cell.dataset.field);
    });
  }

  // ── Nav Focus (highlights a cell without editing) ─────────────

  _setNavFocus(txnId, field) {
    els('.nav-focus').forEach(c => c.classList.remove('nav-focus'));
    this.navPos = { txnId, field };
    this._applyNavFocus(txnId, field);
  }

  _applyNavFocus(txnId, field) {
    const row  = el(`[data-txn-id="${txnId}"]`);
    const cell = row?.querySelector(`[data-field="${field}"]`);
    if (cell) {
      cell.classList.add('nav-focus');
      cell.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  _navMove(dRow, dCol) {
    if (!this.transactions.length) return;
    const txns = this.transactions;

    // Starting position
    let rowIdx = this.navPos ? txns.findIndex(t => t.id === this.navPos.txnId) : 0;
    let colIdx = this.navPos ? EDITABLE_COLS.indexOf(this.navPos.field) : 0;
    if (rowIdx < 0) rowIdx = 0;
    if (colIdx < 0) colIdx = 0;

    // Apply movement
    colIdx += dCol;
    if (colIdx < 0) { colIdx = EDITABLE_COLS.length - 1; rowIdx = Math.max(0, rowIdx - 1); }
    if (colIdx >= EDITABLE_COLS.length) { colIdx = 0; rowIdx = Math.min(txns.length - 1, rowIdx + 1); }
    rowIdx = Math.max(0, Math.min(txns.length - 1, rowIdx + dRow));

    this._setNavFocus(txns[rowIdx].id, EDITABLE_COLS[colIdx]);
  }

  _navJump(position) {
    if (!this.transactions.length) return;
    const txns = this.transactions;
    const rowIdx = position === 'first' ? 0 : txns.length - 1;
    const colIdx = this.navPos ? Math.max(0, EDITABLE_COLS.indexOf(this.navPos.field)) : 0;
    this._setNavFocus(txns[rowIdx].id, EDITABLE_COLS[colIdx]);
  }

  _activateNavCell() {
    if (!this.navPos) return;
    const row  = el(`[data-txn-id="${this.navPos.txnId}"]`);
    const cell = row?.querySelector(`[data-field="${this.navPos.field}"]`);
    if (cell) this._startEdit(cell, this.navPos.txnId, this.navPos.field);
  }

  // ── Inline Edit ───────────────────────────────────────────────

  _startEdit(cell, id, field) {
    if (this.inEdit) return;
    cell.classList.add('focused');
    this.inEdit = true;

    const txn   = this.transactions.find(t => t.id === id);
    const value = txn ? (txn[field] ?? '') : '';
    const isNum = field === 'credit' || field === 'debit';

    const input = document.createElement('input');
    input.className = `cell-input${isNum ? ' text-mono' : ''}`;
    input.type  = isNum ? 'number' : 'text';
    input.value = isNum ? (parseFloat(value) || '') : (value || '');
    input.step  = 'any';
    if (isNum) { input.style.textAlign = 'right'; input.style.width = '100%'; }

    const inner = cell.querySelector('.cell-inner');
    inner.innerHTML = '';
    inner.appendChild(input);
    input.focus();
    if (!isNum) input.select();

    if (!isNum)
      input.addEventListener('input', debounce(() => this.autocomplete.show(input, input.value), 220));

    let committed = false;

    const commit = async () => {
      if (committed) return;
      committed = true;
      this.inEdit = false;
      cell.classList.remove('focused');
      this.autocomplete.hide();

      const newVal = isNum ? (parseFloat(input.value) || 0) : input.value.trim();
      const oldVal = isNum ? (parseFloat(value) || 0) : (value || '');

      // Restore display even if nothing changed
      this._refreshCell(cell, id, field, txn);

      if (newVal === oldVal) return;

      const before = { [field]: oldVal };
      const after  = { [field]: newVal };

      await this._patchTxn(id, after);

      // Push undo AFTER patch succeeds
      this.undoMgr.push({
        label: `Edit ${field}`,
        undo: async app => { await app._patchTxn(id, before); },
        redo: async app => { await app._patchTxn(id, after); },
      });
    };

    input.addEventListener('blur', () => { commit(); });

    input.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await commit();
        if (!e.shiftKey) this._navMove(1, 0);
        else this._navMove(-1, 0);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        await commit();
        this._navMove(0, e.shiftKey ? -1 : 1);
        setTimeout(() => this._activateNavCell(), 30);
      }
      if (e.key === 'Escape') {
        committed = true; // prevent blur from committing
        this.inEdit = false;
        cell.classList.remove('focused');
        this.autocomplete.hide();
        this._refreshCell(cell, id, field, txn);
      }
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        await this._copyDown(id, field);
      }
    });
  }

  _refreshCell(cell, id, field, txn) {
    if (!txn) { txn = this.transactions.find(t => t.id === id); }
    if (!txn) return;
    const val   = txn[field];
    const isNum = field === 'credit' || field === 'debit';
    const inner = cell.querySelector('.cell-inner');
    if (isNum) {
      inner.innerHTML = val > 0
        ? `<span class="amount-text">${fmt(val)}</span>`
        : `<span class="text-muted" style="font-size:11px">—</span>`;
    } else {
      inner.innerHTML = `<span class="cell-text truncate" style="max-width:200px">${val || ''}</span>`;
    }
  }

  async _copyDown(id, field) {
    const idx = this.transactions.findIndex(t => t.id === id);
    if (idx <= 0) { toast('No row above to copy', 'info', 1500); return; }
    const srcVal = this.transactions[idx - 1][field];
    await this._patchTxn(id, { [field]: srcVal });
    toast('Copied from above', 'info', 1400);
    this.undoMgr.push({
      label: 'Copy down',
      undo: async app => { await app._patchTxn(id, { [field]: this.transactions[idx][field] }); },
      redo: async app => { await app._patchTxn(id, { [field]: srcVal }); },
    });
  }

  async _patchTxn(id, patch) {
    try {
      await $.put(`/api/txn/${id}`, patch);
      const txn = this.transactions.find(t => t.id === id);
      if (txn) Object.assign(txn, patch);
      this._recalcBalances();
      this._refreshRowCell(id, patch);
      if ('credit' in patch || 'debit' in patch) {
        this.refreshKPIs();
        this._renderFooter();
        this._renderHeader();
      }
      this.autocomplete.invalidate();
    } catch (e) { toast('Save failed', 'error'); }
  }

  _recalcBalances() {
    let running = 0;
    this.transactions.forEach(t => {
      running = Math.round((running + (t.credit || 0) - (t.debit || 0)) * 1e6) / 1e6;
      t.running_balance = running;
    });
    this.transactions.forEach(t => {
      const row  = el(`[data-txn-id="${t.id}"]`);
      const cell = row?.querySelector('.col-balance');
      if (!cell) return;
      const bal = t.running_balance;
      cell.className = `col-balance cell-balance ${bal >= 0 ? 'positive' : 'negative'}`;
      cell.querySelector('.cell-inner').innerHTML =
        `<span class="text-mono" style="font-size:12px">${fmt(bal)}</span>`;
    });
  }

  _refreshRowCell(id, patch) {
    const row = el(`[data-txn-id="${id}"]`);
    if (!row) return;
    const txn = this.transactions.find(t => t.id === id);
    if (!txn) return;
    Object.keys(patch).forEach(field => {
      const cell = row.querySelector(`[data-field="${field}"]`);
      if (!cell || cell.classList.contains('focused')) return;
      this._refreshCell(cell, id, field, txn);
    });
    if (patch.status !== undefined) {
      const b = row.querySelector('.status-badge');
      if (b) { b.className = `status-badge status-${patch.status}`; b.textContent = patch.status; }
    }
    if (patch.color_flag !== undefined) {
      const d = row.querySelector('.color-flag-dot');
      if (d) d.className = `color-flag-dot flag-${patch.color_flag || 'none'}`;
      row.className = row.className.replace(/flag-\w+/g, '').trim();
      if (patch.color_flag) row.classList.add(`flag-${patch.color_flag}`);
    }
  }

  _renderFooter() {
    if (!this.transactions) return;
    let fc = 0, fd = 0;
    this.transactions.forEach(t => { fc += t.credit || 0; fd += t.debit || 0; });
    const net = fc - fd;
    el('#footer-credits').textContent = fmt(fc);
    el('#footer-debits').textContent  = fmt(fd);
    const n = el('#footer-net');
    n.textContent = fmt(Math.abs(net));
    n.className   = `footer-stat-val ${net >= 0 ? 'net-pos' : 'net-neg'}`;
    el('#footer-count').textContent = `${this.transactions.length} entries`;
  }

  // ── Add / Delete Transactions ─────────────────────────────────

  async quickAddRow() { this.openQuickAdd(); }

  async addTransaction(data) {
    if (!this.currentAccountId) return;
    try {
      const txn = await $.post(`/api/accounts/${this.currentAccountId}/txn`, data);
      this.transactions.push({ ...txn, running_balance: 0 });
      this._recalcBalances();
      this._renderLedger();
      this._renderFooter();
      this._renderHeader();
      this.refreshKPIs();
      setTimeout(() => {
        const row = el(`[data-txn-id="${txn.id}"]`);
        row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        this._setNavFocus(txn.id, 'credit');
        setTimeout(() => this._activateNavCell(), 60);
      }, 60);
      this.undoMgr.push({
        label: 'Add entry',
        undo: async app => { await app.deleteTxn(txn.id, true); },
        redo: async app => { await app.loadLedger(); },
      });
    } catch { toast('Failed to add entry', 'error'); }
  }

  async deleteTxn(id, silent = false) {
    if (!silent && !confirm('Delete this entry?')) return;
    const txn = this.transactions.find(t => t.id === id);
    try {
      await $.del(`/api/txn/${id}`);
      this.transactions = this.transactions.filter(t => t.id !== id);
      this._recalcBalances();
      el(`[data-txn-id="${id}"]`)?.remove();
      this._renderFooter();
      this.refreshKPIs();
      if (!silent) toast('Entry deleted', 'success');
    } catch { toast('Delete failed', 'error'); }
  }

  // ── Status / Flag ─────────────────────────────────────────────

  async cycleStatus(id, badge) {
    const order = ['normal', 'unpaid', 'flagged', 'done', 'reminder'];
    const cur   = [...badge.classList].find(c => c.startsWith('status-'))?.replace('status-', '') || 'normal';
    const next  = order[(order.indexOf(cur) + 1) % order.length];
    await this._patchTxn(id, { status: next });
  }

  async cycleFlag(id, dot) {
    const order = ['', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    const cur   = [...dot.classList].find(c => c.startsWith('flag-') && c !== 'flag-none')?.replace('flag-', '') || '';
    const next  = order[(order.indexOf(cur) + 1) % order.length];
    await this._patchTxn(id, { color_flag: next });
  }

  // ── KPIs ──────────────────────────────────────────────────────

  async refreshKPIs() {
    try { const k = await $.get('/api/kpis'); this._renderKPIs(k); } catch {}
  }

  _renderKPIs(k) {
    const s = '₹';
    el('#kpi-manual').textContent     = `${s}${fmt(k.manual_balance)}`;
    el('#kpi-system').textContent     = `${s}${fmt(k.system_total)}`;
    el('#kpi-diff-val').textContent   = `${s}${fmt(Math.abs(k.difference))}`;
    el('#kpi-diff-sign').textContent  = k.difference < 0 ? '−' : k.difference > 0 ? '+' : '=';
    el('#kpi-diff-card').className    = `kpi-card kpi-diff ${k.difference < 0 ? 'negative' : ''}`;
    el('#kpi-manual-sub').textContent = `H: ${s}${fmt(k.h_balance,0)} · T: ${s}${fmt(k.t_value,0)}`;
    el('#kpi-system-sub').textContent = `Credits: ${s}${fmt(k.total_credits,0)} · Debits: ${s}${fmt(k.total_debits,0)}`;
    if (el('#t-value-input').value === '')       el('#t-value-input').value       = k.t_value || '';
    if (el('#previous-value-input').value === '') el('#previous-value-input').value = k.previous_value || '';
    if (el('#updated-till-input').value === '')  el('#updated-till-input').value  = k.updated_till || '';
  }

  // ── T Value ───────────────────────────────────────────────────

  _setupTValue() {
    const inp = el('#t-value-input');
    inp.addEventListener('change', debounce(async () => {
      const val = parseFloat(inp.value) || 0;
      await $.put('/api/settings', { t_value: String(val) });
      await this.refreshKPIs();
      toast('T value updated', 'success', 1500);
    }, 400));
  }

  // ── Previous Balance ──────────────────────────────────────────

  _setupPreviousValue() {
    const inp = el('#previous-value-input');
    inp.addEventListener('change', debounce(async () => {
      const val = parseFloat(inp.value) || 0;
      await $.put('/api/settings', { previous_value: String(val) });
      toast('Previous balance updated', 'success', 1500);
    }, 400));
  }

  // ── Updated Till Date ─────────────────────────────────────────

  _setupUpdatedTill() {
    el('#updated-till-input').addEventListener('change', async () => {
      await $.put('/api/settings', { updated_till: el('#updated-till-input').value });
      toast('Updated till date saved', 'success', 1500);
    });
  }

  // ── Filters ───────────────────────────────────────────────────

  setupFilters() {
    els('.filter-btn[data-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        els('.filter-btn[data-type]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filters.type = btn.dataset.type;
        this.loadLedger();
      });
    });
    els('.filter-btn[data-status]').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.status;
        if (this.filters.status === s) { this.filters.status = ''; btn.classList.remove('active'); }
        else { els('.filter-btn[data-status]').forEach(b => b.classList.remove('active')); btn.classList.add('active'); this.filters.status = s; }
        this.loadLedger();
      });
    });
    el('#filter-date-from').addEventListener('change', e => { this.filters.date_from = e.target.value; this.loadLedger(); });
    el('#filter-date-to').addEventListener('change',   e => { this.filters.date_to   = e.target.value; this.loadLedger(); });
    el('#filter-q').addEventListener('input', debounce(e => { this.filters.q = e.target.value.trim(); this.loadLedger(); }, 300));
  }

  // ── Checkboxes ────────────────────────────────────────────────

  _attachCheckboxEvents() {
    el('#header-checkbox')?.addEventListener('change', e => {
      const chk = e.target.checked;
      this.transactions.forEach(t => { if (chk) this.selectedRows.add(t.id); else this.selectedRows.delete(t.id); });
      els('.row-checkbox').forEach(cb => { cb.checked = chk; cb.closest('.ledger-row')?.classList.toggle('selected', chk); });
      this._updateSelectionToolbar();
    });
    els('.row-checkbox').forEach(cb => {
      cb.addEventListener('change', e => {
        const id = parseInt(e.target.dataset.id);
        if (e.target.checked) this.selectedRows.add(id); else this.selectedRows.delete(id);
        e.target.closest('.ledger-row')?.classList.toggle('selected', e.target.checked);
        this._updateSelectionToolbar();
      });
    });
  }

  _updateSelectionToolbar() {
    const n = this.selectedRows.size;
    el('#selection-toolbar').classList.toggle('visible', n > 0);
    el('#sel-count').textContent = `${n} selected`;
  }

  async bulkAction(action, extra = {}) {
    if (!this.selectedRows.size) return;
    const ids = [...this.selectedRows];
    try {
      await $.post('/api/txn/bulk', { action, ids, ...extra });
      this.selectedRows.clear();
      await this.loadLedger();
      await this.refreshKPIs();
      toast(`${action} applied to ${ids.length} entries`, 'success');
    } catch { toast('Bulk action failed', 'error'); }
  }

  // ── Modals ────────────────────────────────────────────────────

  _setupModals() {
    el('#quick-add-overlay').addEventListener('click', e => { if (e.target === el('#quick-add-overlay')) this.closeQuickAdd(); });
    el('#quick-add-close').addEventListener('click', () => this.closeQuickAdd());
    el('#quick-add-submit').addEventListener('click', () => this._submitQuickAdd(false));
    el('#quick-add-and-continue').addEventListener('click', () => this._submitQuickAdd(true));
    this._setupQaAccountCombobox();
    el('#acct-modal-overlay').addEventListener('click', e => { if (e.target === el('#acct-modal-overlay')) this.closeAccountModal(); });
    el('#acct-modal-close').addEventListener('click', () => this.closeAccountModal());
    el('#acct-modal-save').addEventListener('click', () => this._saveAccountModal());
    el('#add-account-btn').addEventListener('click', () => this.showAddAccountModal());
    el('#summary-btn').addEventListener('click', () => this.openSummary());
    el('#export-btn').addEventListener('click', () => { window.location.href = '/api/export/excel'; });
    el('#changes-btn').addEventListener('click', () => this.openChanges());
    el('#zero-bal-btn').addEventListener('click', () => this.openZeroBalance());
    el('#sel-delete').addEventListener('click', () => this.bulkAction('delete'));
    el('#sel-unpaid').addEventListener('click', () => this.bulkAction('status', { status: 'unpaid' }));
    el('#sel-flag').addEventListener('click',   () => this.bulkAction('color_flag', { color_flag: 'red' }));
    el('#sel-clear').addEventListener('click',  () => {
      this.selectedRows.clear();
      els('.row-checkbox').forEach(cb => { cb.checked = false; });
      els('.ledger-row').forEach(r => r.classList.remove('selected'));
      this._updateSelectionToolbar();
    });
    this.setupFilters();
  }

  _setupQaAccountCombobox() {
    const inp  = el('#qa-account-input');
    const hid  = el('#qa-account');
    const drop = el('#qa-account-dropdown');
    let hoverId = null;

    const label = a => a.name + (a.number ? ' · ' + a.number : '');
    const list  = () => this.accounts.filter(a => !a.is_archived);

    const renderDrop = (items, q = '') => {
      let html = items.map(a =>
        `<div class="qa-acct-item" data-id="${a.id}">${label(a).replace(/</g,'&lt;')}</div>`
      ).join('');
      // Always show "＋ Create" option when user has typed something
      if (q) {
        html += `<div class="qa-acct-item qa-acct-new" data-create="1">＋ Add "<b>${q.replace(/</g,'&lt;')}</b>" as new account</div>`;
      }
      if (!html) { drop.classList.remove('open'); return; }
      drop.innerHTML = html;
      drop.querySelectorAll('.qa-acct-item[data-id]').forEach(it => {
        it.addEventListener('mouseenter', () => {
          drop.querySelectorAll('.qa-acct-item').forEach(x => x.classList.remove('active'));
          it.classList.add('active');
          hoverId = parseInt(it.dataset.id);
        });
        it.addEventListener('mousedown', e => { e.preventDefault(); pick(parseInt(it.dataset.id)); });
      });
      const createEl = drop.querySelector('.qa-acct-new');
      if (createEl) {
        createEl.addEventListener('mouseenter', () => {
          drop.querySelectorAll('.qa-acct-item').forEach(x => x.classList.remove('active'));
          createEl.classList.add('active');
          hoverId = null;
        });
        createEl.addEventListener('mousedown', e => { e.preventDefault(); this._createAccountFromQA(inp.value.trim()); });
      }
      drop.classList.add('open');
      hoverId = null;
    };

    const hideDrop = () => { drop.classList.remove('open'); hoverId = null; };

    const pick = (id) => {
      const a = list().find(x => x.id === id);
      if (!a) return;
      hid.value = id;
      inp.value = label(a);
      hideDrop();
      this._showQaPreview(id, a);
    };

    inp.addEventListener('focus', () => {
      inp.select();
      const q = inp.value.toLowerCase().trim();
      const matches = list().filter(a => !q || label(a).toLowerCase().includes(q));
      renderDrop(matches.length ? matches : list(), q);
    });

    inp.addEventListener('input', () => {
      hid.value = '';
      const q = inp.value.toLowerCase().trim();
      const matches = list().filter(a => label(a).toLowerCase().includes(q));
      renderDrop(matches, q);
    });

    inp.addEventListener('keydown', e => {
      const acctItems   = [...drop.querySelectorAll('.qa-acct-item[data-id]')];
      const createItem  = drop.querySelector('.qa-acct-new');
      const allItems    = createItem ? [...acctItems, createItem] : acctItems;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const cur  = allItems.findIndex(it => it.classList.contains('active'));
        const next = allItems[cur + 1] || allItems[0];
        allItems.forEach(it => it.classList.remove('active'));
        next?.classList.add('active');
        next?.scrollIntoView({ block: 'nearest' });
        hoverId = next?.dataset.id ? parseInt(next.dataset.id) : null;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const cur  = allItems.findIndex(it => it.classList.contains('active'));
        const prev = allItems[cur - 1] || allItems[allItems.length - 1];
        allItems.forEach(it => it.classList.remove('active'));
        prev?.classList.add('active');
        prev?.scrollIntoView({ block: 'nearest' });
        hoverId = prev?.dataset.id ? parseInt(prev.dataset.id) : null;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const active = drop.querySelector('.qa-acct-item.active');
        if (active?.dataset.create) {
          e.preventDefault();
          this._createAccountFromQA(inp.value.trim());
        } else if (active?.dataset.id) {
          e.preventDefault();
          pick(parseInt(active.dataset.id));
          el('#qa-date').focus();
        } else if (acctItems.length === 1) {
          e.preventDefault();
          pick(parseInt(acctItems[0].dataset.id));
          el('#qa-date').focus();
        }
      } else if (e.key === 'Escape') {
        hideDrop();
      }
    });

    inp.addEventListener('blur', () => {
      setTimeout(() => {
        hideDrop();
        if (!hid.value) {
          const q = inp.value.toLowerCase().trim();
          const exact = list().find(a => label(a).toLowerCase() === q);
          if (exact) { hid.value = exact.id; }
          else { inp.value = hid.value ? label(list().find(a => a.id === parseInt(hid.value)) || {name:''}) : ''; }
        }
      }, 160);
    });

    document.addEventListener('click', e => {
      if (!el('.qa-acct-wrap')?.contains(e.target)) hideDrop();
    });

    this._qaAcctPick = pick;
  }

  _createAccountFromQA(name) {
    this._qaNewAccountPending = true;
    el('#acct-modal-title').textContent = 'Add Account';
    el('#acct-name').value    = name;
    el('#acct-number').value  = '';
    el('#acct-group').value   = 'regular';
    el('#acct-color').value   = '';
    el('#acct-notes').value   = '';
    el('#acct-modal-overlay').dataset.editId = '';
    el('#acct-modal-overlay').classList.add('open');
    setTimeout(() => el('#acct-number').focus(), 50);
  }

  async _showQaPreview(id, acctObj) {
    const panel = el('#qa-preview');
    if (!panel) return;

    const acct = acctObj || this.accounts.find(a => a.id === id);
    const bal  = acct?.balance ?? 0;
    const balClass = Math.abs(bal) < 0.005 ? 'zero' : (bal >= 0 ? 'pos' : 'neg');
    const fmtAmt = v => '₹' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDate = s => {
      if (!s) return '—';
      const d = new Date(s + 'T00:00:00');
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    };

    panel.innerHTML = `
      <div class="qa-prev-head">
        <div class="qa-prev-acct-name">${(acct?.name || '').replace(/</g,'&lt;')}</div>
        <div class="qa-prev-bal-label">Current Balance</div>
        <div class="qa-prev-bal-val ${balClass}">${bal < 0 ? '−' : ''}${fmtAmt(bal)}</div>
      </div>
      <div class="qa-prev-body"><div class="qa-prev-empty">Loading…</div></div>`;
    panel.classList.add('visible');

    try {
      const data = await $.get(`/api/accounts/${id}/ledger?limit=8`);
      const txns = (data.transactions || []).slice().reverse();

      let body = '';
      if (!txns.length) {
        body = '<div class="qa-prev-empty">No transactions yet</div>';
      } else {
        body += `<div class="qa-prev-cols">
          <span>Date</span>
          <span class="qa-prev-cols-cr">↑ Credit</span>
          <span class="qa-prev-cols-dr">↓ Debit</span>
        </div>`;
        for (const t of txns) {
          const crCell = t.credit > 0
            ? `<div class="qa-prev-amt cr">${fmtAmt(t.credit)}</div><div class="qa-prev-rem">${(t.credit_remark || '').replace(/</g,'&lt;')}</div>`
            : '';
          const drCell = t.debit > 0
            ? `<div class="qa-prev-amt dr">${fmtAmt(t.debit)}</div><div class="qa-prev-rem">${(t.debit_remark || '').replace(/</g,'&lt;')}</div>`
            : '';
          body += `<div class="qa-prev-row">
            <div class="qa-prev-date">${fmtDate(t.txn_date)}</div>
            <div class="qa-prev-cell">${crCell}</div>
            <div class="qa-prev-cell">${drCell}</div>
          </div>`;
        }
      }
      panel.querySelector('.qa-prev-body').innerHTML = body;
    } catch {
      panel.querySelector('.qa-prev-body').innerHTML = '<div class="qa-prev-empty">—</div>';
    }
  }

  openQuickAdd() {
    el('#quick-add-overlay').classList.add('open');
    el('#qa-date').value = this._defaultDate();
    el('#qa-txn-date').value = this.lastUsedTxnDate || '';
    const preselect = this.currentAccountId || (this.accounts.find(a => !a.is_archived)?.id);
    if (preselect) this._qaAcctPick(preselect);
    setTimeout(() => el('#qa-account-input').focus(), 50);
  }

  closeQuickAdd() {
    el('#quick-add-overlay').classList.remove('open');
    el('#qa-preview')?.classList.remove('visible');
    els('#quick-add-modal .form-input').forEach(i => { i.value = ''; });
    el('#qa-account').value = '';
    el('#qa-account-dropdown').classList.remove('open');
    document.body.focus();
  }

  async _submitQuickAdd(andContinue = false) {
    const acctId = parseInt(el('#qa-account').value);
    if (!acctId) { toast('Select an account', 'warning'); return; }
    const txnDate    = el('#qa-date').value;
    const txnActDate = el('#qa-txn-date').value;
    if (txnDate)    { this.lastUsedDate    = txnDate;    localStorage.setItem('fin_last_date',     txnDate); }
    if (txnActDate) { this.lastUsedTxnDate = txnActDate; localStorage.setItem('fin_last_txn_date', txnActDate); }
    const data = {
      txn_date:         txnDate,
      transaction_date: txnActDate || null,
      credit:           parseFloat(el('#qa-credit').value) || 0,
      credit_remark:    el('#qa-credit-remark').value.trim(),
      debit:            parseFloat(el('#qa-debit').value) || 0,
      debit_remark:     el('#qa-debit-remark').value.trim(),
      status:           el('#qa-status').value,
    };
    if (!data.credit && !data.debit) { toast('Enter credit or debit amount', 'warning'); return; }
    try {
      const txn = await $.post(`/api/accounts/${acctId}/txn`, data);
      // If entry was added to the currently open account, reflect it in the ledger
      if (acctId === this.currentAccountId) {
        this.transactions.push({ ...txn, running_balance: 0 });
        this._recalcBalances();
        await this.loadLedger();
      }
      await this.refreshKPIs();
      const acct = this.accounts.find(a => a.id === acctId);
      toast(`Added to ${acct?.name || 'account'}`, 'success');
    } catch { toast('Failed to add entry', 'error'); return; }
    if (andContinue) {
      ['#qa-credit','#qa-debit','#qa-credit-remark','#qa-debit-remark'].forEach(s => { el(s).value = ''; });
      setTimeout(() => el('#qa-account-input').focus(), 30);
    } else { this.closeQuickAdd(); }
  }

  editCurrentAccount() {
    const acct = this.accounts.find(a => a.id === this.currentAccountId);
    if (acct) this.showAddAccountModal(acct);
  }

  // ── Summary Page ──────────────────────────────────────────────

  openSummary() {
    this._summaryMode    = 'all';
    this._summaryCustom  = [];   // ids chosen in custom mode
    el('#summary-overlay').classList.add('open');
    this._renderSummary();
    this._setupSummaryEvents();
  }

  closeSummary() {
    el('#summary-overlay').classList.remove('open');
    document.body.focus();
  }

  // ── Changes Panel ─────────────────────────────────────────────

  openChanges() {
    el('#changes-overlay').classList.add('open');
    if (!this._changesEventsAttached) {
      this._changesEventsAttached = true;
      el('#changes-close').addEventListener('click', () => this.closeChanges());
      el('#changes-overlay').addEventListener('click', e => { if (e.target === el('#changes-overlay')) this.closeChanges(); });
      els('.chg-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          els('.chg-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const mode = btn.dataset.chgMode;
          el('#chg-date-wrap').style.display = mode === 'date' ? 'flex' : 'none';
          if (mode !== 'date') this._loadChanges(mode);
        });
      });
      el('#chg-date-input').addEventListener('change', () => {
        const v = el('#chg-date-input').value;
        if (v) this._loadChanges('date', v);
      });
    }
    this._loadChanges('session');
  }

  closeChanges() {
    el('#changes-overlay').classList.remove('open');
    document.body.focus();
  }

  async _loadChanges(mode, dateVal) {
    const body = el('#chg-body');
    body.innerHTML = '<div class="chg-empty">Loading…</div>';
    let url = '/api/audit?limit=200';
    if (mode === 'today') {
      url += `&date=${new Date().toISOString().slice(0, 10)}`;
    } else if (mode === 'session') {
      url += `&since=${new Date(this._sessionStart).toISOString()}`;
    } else if (mode === 'date' && dateVal) {
      url += `&date=${dateVal}`;
    }
    let logs;
    try { logs = await $.get(url); } catch { body.innerHTML = '<div class="chg-empty">Failed to load changes.</div>'; return; }

    el('#chg-count').textContent = logs.length ? `${logs.length} change${logs.length > 1 ? 's' : ''}` : '';

    if (!logs.length) {
      body.innerHTML = '<div class="chg-empty">No changes found.</div>';
      return;
    }

    // Group by date
    const groups = {};
    logs.forEach(l => {
      const d = l.created_at ? l.created_at.slice(0, 10) : 'Unknown';
      if (!groups[d]) groups[d] = [];
      groups[d].push(l);
    });

    const fmtTime = iso => {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    const fmtAmt = n => n != null ? `₹${fmt(Math.abs(parseFloat(n) || 0))}` : null;

    let html = '';
    Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach(date => {
      const label = date === new Date().toISOString().slice(0, 10) ? 'Today' : date;
      html += `<div class="chg-group-label">${label}</div>`;
      groups[date].forEach(l => {
        const action  = (l.action || '').toLowerCase();
        const entity  = (l.entity_type || '').toLowerCase();
        const dotCls  = action.includes('delet') ? 'delete' : action.includes('creat') ? 'create' : entity === 'setting' ? 'setting' : 'update';
        const eBadge  = entity === 'txn' ? 'chg-badge-txn' : entity === 'account' ? 'chg-badge-acct' : 'chg-badge-set';
        const eLabel  = entity === 'txn' ? 'Txn' : entity === 'account' ? 'Account' : entity === 'setting' ? 'Setting' : entity;
        const aBadge  = action.includes('creat') ? 'chg-badge-create' : action.includes('delet') ? 'chg-badge-delete' : 'chg-badge-update';
        const aLabel  = action.charAt(0).toUpperCase() + action.slice(1);
        const acct    = l.account_name ? `<span class="chg-acct-name">${l.account_name}</span>` : '';
        const desc    = l.description  ? `<div class="chg-entry-desc" title="${l.description}">${l.description}</div>` : '';

        let amtsHtml = '';
        try {
          const after  = l.after_data  ? JSON.parse(l.after_data)  : null;
          const before = l.before_data ? JSON.parse(l.before_data) : null;
          const parts  = [];
          if (after?.credit  > 0) parts.push(`<span class="chg-amt credit">Cr ${fmtAmt(after.credit)}</span>`);
          if (after?.debit   > 0) parts.push(`<span class="chg-amt debit">Dr ${fmtAmt(after.debit)}</span>`);
          if (before && after && (before.credit !== after.credit || before.debit !== after.debit)) {
            const diff = ((after.credit || 0) - (after.debit || 0)) - ((before.credit || 0) - (before.debit || 0));
            if (diff !== 0) parts.push(`<span class="chg-amt diff">Δ ${diff >= 0 ? '+' : ''}${fmtAmt(diff)}</span>`);
          }
          if (parts.length) amtsHtml = `<div class="chg-amounts">${parts.join('')}</div>`;
        } catch {}

        html += `<div class="chg-entry">
          <div class="chg-dot ${dotCls}"></div>
          <div class="chg-entry-main">
            <div class="chg-entry-top">
              <span class="chg-badge ${eBadge}">${eLabel}</span>
              <span class="chg-badge ${aBadge}">${aLabel}</span>
              ${acct}
            </div>
            ${desc}${amtsHtml}
          </div>
          <div class="chg-time">${fmtTime(l.created_at)}</div>
        </div>`;
      });
    });
    body.innerHTML = html;
  }

  _setupSummaryEvents() {
    if (this._summaryEventsAttached) return;
    this._summaryEventsAttached = true;

    el('#summary-close').addEventListener('click', () => this.closeSummary());
    el('#summary-overlay').addEventListener('click', e => {
      if (e.target === el('#summary-overlay')) this.closeSummary();
    });

    // Filter tabs
    el('#sum-filters').addEventListener('click', e => {
      const btn = e.target.closest('.sum-filter-btn');
      if (!btn) return;
      els('.sum-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._summaryMode = btn.dataset.mode;
      const bar = el('#sum-custom-bar');
      this._summaryMode === 'custom' ? bar.classList.add('visible') : bar.classList.remove('visible');
      this._renderSummary();
    });

    // "Add Pinned" button — bulk-adds all currently pinned accounts
    el('#sum-add-pinned-btn').addEventListener('click', () => {
      const pinned = this.accounts.filter(a => a.is_pinned);
      if (!pinned.length) { toast('No pinned accounts', 'warning'); return; }
      let added = 0;
      pinned.forEach(a => {
        if (!this._summaryCustom.includes(a.id)) {
          this._summaryCustom.push(a.id);
          added++;
        }
      });
      this._renderCustomTags();
      this._renderSummary();
      if (added) toast(`Added ${added} pinned account${added > 1 ? 's' : ''}`, 'success');
    });

    // Clear all
    el('#sum-clear-custom').addEventListener('click', () => {
      this._summaryCustom = [];
      this._renderCustomTags();
      this._renderSummary();
    });

    // Search & add individual accounts
    const inp = el('#sum-custom-input');
    const dd  = el('#sum-custom-dropdown');
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      if (!q) { dd.classList.remove('open'); return; }
      const matches = this.accounts.filter(a =>
        !this._summaryCustom.includes(a.id) &&
        (a.name.toLowerCase().includes(q) || (a.number||'').toLowerCase().includes(q))
      ).slice(0, 12);
      dd.innerHTML = matches.length
        ? matches.map(a => `
            <div class="sum-custom-dd-item" data-id="${a.id}">
              <span style="width:8px;height:8px;border-radius:50%;background:${a.balance>=0?'var(--credit)':'var(--debit)'};flex-shrink:0;display:inline-block"></span>
              <span style="flex:1">${a.name}</span>
              ${a.is_pinned ? '<span style="color:#f59e0b;font-size:10px">★</span>' : ''}
              <span style="font-size:10px;color:var(--text-muted)">${a.txn_count||0} entries</span>
            </div>`).join('')
        : '<div class="sum-custom-dd-item" style="color:var(--text-muted);cursor:default">No matches</div>';
      dd.classList.add('open');
    });
    dd.addEventListener('click', e => {
      const item = e.target.closest('[data-id]');
      if (!item) return;
      const id = parseInt(item.dataset.id);
      if (!this._summaryCustom.includes(id)) {
        this._summaryCustom.push(id);
        this._renderCustomTags();
        this._renderSummary();
      }
      inp.value = '';
      dd.classList.remove('open');
      inp.focus();
    });
    document.addEventListener('click', e => {
      if (!el('#sum-custom-bar')?.contains(e.target)) dd.classList.remove('open');
    }, { capture: true });
  }

  _renderCustomTags() {
    const container = el('#sum-custom-tags');
    const clearBtn  = el('#sum-clear-custom');
    const countLbl  = el('#sum-sel-count');
    const n = this._summaryCustom.length;
    countLbl.textContent = `${n} selected`;
    clearBtn.style.display = n ? '' : 'none';
    container.innerHTML = this._summaryCustom.map(id => {
      const a = this.accounts.find(x => x.id === id);
      if (!a) return '';
      const pinCls = a.is_pinned ? ' pinned-tag' : '';
      const pinIco = a.is_pinned ? '★ ' : '';
      return `<span class="sum-custom-tag${pinCls}">${pinIco}${a.name}<button onclick="window.finApp._removeSummaryCustom(${id})" title="Remove">×</button></span>`;
    }).join('');
  }

  _removeSummaryCustom(id) {
    this._summaryCustom = this._summaryCustom.filter(x => x !== id);
    this._renderCustomTags();
    this._renderSummary();
  }

  _renderSummary() {
    let accts = this.accounts.slice();
    if (this._summaryMode === 'pinned') {
      accts = accts.filter(a => a.is_pinned);
    } else if (this._summaryMode === 'custom') {
      accts = accts.filter(a => this._summaryCustom.includes(a.id));
    }

    const credit = accts.filter(a => (a.balance || 0) >= 0).sort((a, b) => (b.balance||0) - (a.balance||0));
    const debit  = accts.filter(a => (a.balance || 0) < 0).sort((a, b)  => (a.balance||0) - (b.balance||0));

    el('#sum-credit-count').textContent = credit.length;
    el('#sum-debit-count').textContent  = debit.length;

    const s = '₹';
    const row = a => {
      const bal  = a.balance || 0;
      const side = bal >= 0 ? 'credit' : 'debit';
      const pin  = a.is_pinned ? '<span class="sum-acct-pin">★</span>' : '';
      const grp  = a.group_type !== 'regular'
        ? `<span class="sum-acct-group ${a.group_type}">${a.group_type.toUpperCase()}</span>` : '';
      return `<div class="sum-acct-row" onclick="window.finApp.closeSummary();window.finApp.openAccount(${a.id})">
        <span class="sum-acct-dot ${side}"></span>
        <span class="sum-acct-name">${a.name}</span>
        ${pin}${grp}
        <span class="sum-acct-meta">${a.txn_count || 0} entries</span>
        <span class="sum-acct-bal ${side}">${side === 'debit' ? '−' : ''}${s}${fmt(Math.abs(bal))}</span>
      </div>`;
    };

    el('#sum-credit-list').innerHTML = credit.length
      ? credit.map(row).join('')
      : '<div class="sum-empty">No credit accounts</div>';
    el('#sum-debit-list').innerHTML  = debit.length
      ? debit.map(row).join('')
      : '<div class="sum-empty">No debit accounts</div>';
  }

  showAddAccountModal(acct = null) {
    el('#acct-modal-title').textContent  = acct ? 'Edit Account' : 'Add Account';
    el('#acct-name').value    = acct?.name || '';
    el('#acct-number').value  = acct?.number || '';
    el('#acct-group').value   = acct?.group_type || 'regular';
    el('#acct-color').value   = acct?.color || '';
    el('#acct-notes').value   = acct?.notes || '';
    el('#acct-modal-overlay').dataset.editId = acct?.id || '';
    el('#acct-modal-overlay').classList.add('open');
    setTimeout(() => el('#acct-name').focus(), 50);
  }

  closeAccountModal() { el('#acct-modal-overlay').classList.remove('open'); document.body.focus(); }

  async _saveAccountModal() {
    const name = el('#acct-name').value.trim();
    if (!name) { toast('Account name required', 'warning'); return; }
    const data = {
      name, number: el('#acct-number').value.trim(),
      group_type: el('#acct-group').value, color: el('#acct-color').value,
      notes: el('#acct-notes').value.trim(),
    };
    const editId  = el('#acct-modal-overlay').dataset.editId;
    const fromQA  = this._qaNewAccountPending;
    try {
      let newId;
      if (editId) { await $.put(`/api/accounts/${editId}`, data); toast('Account updated', 'success'); }
      else { const r = await $.post('/api/accounts', data); newId = r.id; toast(`"${name}" created`, 'success'); }
      this.closeAccountModal();
      await this.loadAccounts();
      await this.refreshKPIs();
      // If created from Quick Add combobox, auto-select the new account
      if (fromQA && newId) {
        this._qaNewAccountPending = false;
        this._qaAcctPick?.(newId);
        setTimeout(() => el('#qa-date')?.focus(), 50);
      }
    } catch { toast('Save failed', 'error'); }
  }

  // ── Context Menus ─────────────────────────────────────────────

  _setupContextMenu() {
    document.addEventListener('click', () => el('#ctx-menu').classList.remove('open'));
  }

  _showAccountCtxMenu(e, id) {
    const a = this.accounts.find(x => x.id === id);
    if (!a) return;
    el('#ctx-menu').innerHTML = `
      <div class="ctx-item" onclick="finApp.openAccount(${id})">📂 Open</div>
      <div class="ctx-item" onclick="finApp.showAddAccountModal(finApp.accounts.find(x=>x.id==${id}))">✏️ Edit</div>
      <div class="ctx-item" onclick="finApp.togglePin(${id})">${a.is_pinned ? '📌 Unpin' : '📌 Pin'}</div>
      <div class="ctx-item" onclick="finApp.duplicateAccount(${id})">📋 Duplicate</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" onclick="finApp.archiveAccount(${id})">🗄️ Archive</div>
      <div class="ctx-item danger" onclick="finApp.deleteAccount(${id})">🗑️ Delete</div>`;
    el('#ctx-menu').style.cssText = `top:${e.clientY}px;left:${e.clientX}px`;
    el('#ctx-menu').classList.add('open');
  }

  _showTxnCtxMenu(e, id) {
    el('#ctx-menu').innerHTML = `
      <div class="ctx-item" onclick="finApp.openNotes(${id})">📝 Notes</div>
      <div class="ctx-item" onclick="finApp._copyDown(${id},'credit')">↓ Copy Credit Down</div>
      <div class="ctx-item" onclick="finApp._copyDown(${id},'debit')">↓ Copy Debit Down</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" onclick="finApp.deleteTxn(${id})">🗑️ Delete</div>`;
    el('#ctx-menu').style.cssText = `top:${e.clientY}px;left:${e.clientX}px`;
    el('#ctx-menu').classList.add('open');
  }

  // ── Account Operations ────────────────────────────────────────

  async togglePin(id) {
    const a = this.accounts.find(x => x.id === id);
    if (!a) return;
    await $.put(`/api/accounts/${id}`, { is_pinned: !a.is_pinned });
    await this.loadAccounts();
  }

  async archiveAccount(id) {
    if (!confirm('Archive this account?')) return;
    await $.del(`/api/accounts/${id}`);
    if (this.currentAccountId === id) this.currentAccountId = null;
    await this.loadAccounts(); await this.refreshKPIs();
    toast('Archived', 'success');
  }

  async deleteAccount(id) {
    if (!id) return;
    if (!confirm('Permanently delete this account and all its transactions?\nThis cannot be undone.')) return;
    try {
      await $.del(`/api/accounts/${id}?force=true`);
      const wasOpen = this.currentAccountId === id;
      if (wasOpen) {
        this.currentAccountId = null;
        this.transactions = [];
        for (const s of ['#top-header','#kpi-bar','#filter-bar','#ledger-footer','#ledger-wrap','#fab'])
          el(s)?.classList.add('hidden');
        // Re-insert welcome state if it was removed
        if (!el('#welcome-state')) {
          const welcome = document.createElement('div');
          welcome.id = 'welcome-state';
          welcome.innerHTML = `<div class="welcome-icon">₹</div>
            <div class="welcome-title">Account deleted</div>
            <div class="welcome-sub">Select another account from the sidebar.</div>`;
          el('#content').prepend(welcome);
        } else {
          el('#welcome-state').style.display = '';
        }
      }
      await this.loadAccounts();
      await this.refreshKPIs();
      toast('Account deleted', 'success');
    } catch { toast('Delete failed', 'error'); }
  }

  // ── Zero Balance Panel ────────────────────────────────────────

  openZeroBalance() {
    el('#zero-bal-overlay').classList.add('open');
    if (!this._zbalEventsAttached) {
      this._zbalEventsAttached = true;
      el('#zero-bal-close').addEventListener('click', () => this.closeZeroBalance());
      el('#zero-bal-overlay').addEventListener('click', e => {
        if (e.target === el('#zero-bal-overlay')) this.closeZeroBalance();
      });
    }
    this._renderZeroBal();
  }

  closeZeroBalance() {
    el('#zero-bal-overlay').classList.remove('open');
    document.body.focus();
  }

  _renderZeroBal() {
    const zeros = this.accounts.filter(a => Math.abs(a.balance || 0) < 0.01);
    el('#zbal-count').textContent = zeros.length ? `${zeros.length} account${zeros.length !== 1 ? 's' : ''}` : '';
    if (!zeros.length) {
      el('#zbal-body').innerHTML = '<div class="chg-empty">✓ No accounts with zero balance.</div>';
      return;
    }
    el('#zbal-body').innerHTML = zeros.map(a => {
      const grp = a.group_type !== 'regular'
        ? `<span class="chg-badge chg-badge-acct">${a.group_type.toUpperCase()}</span>` : '';
      const num = a.number ? `<span class="zbal-num">#${a.number}</span>` : '';
      const nm  = (a.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      return `<div class="zbal-row" id="zbal-row-${a.id}">
        <span class="account-dot ${a.group_type}" style="${a.color ? 'background:' + a.color : ''}"></span>
        <div class="zbal-info">
          <span class="zbal-name">${a.name}</span>
          ${num}${grp}
        </div>
        <span class="zbal-txns">${a.txn_count || 0} txn${(a.txn_count || 0) !== 1 ? 's' : ''}</span>
        <div class="zbal-actions">
          <button class="zbal-btn zbal-open"    title="Open ledger"
            onclick="window.finApp.closeZeroBalance();window.finApp.openAccount(${a.id})">↗</button>
          <button class="zbal-btn zbal-archive" title="Archive account"
            onclick="window.finApp._archiveFromZeroBal(${a.id},'${nm}')">🗄</button>
          <button class="zbal-btn zbal-delete"  title="Delete account permanently"
            onclick="window.finApp._deleteFromZeroBal(${a.id},'${nm}')">🗑</button>
        </div>
      </div>`;
    }).join('');
  }

  async _archiveFromZeroBal(id, name) {
    if (!confirm(`Archive "${name}"?\nIt won't appear in the sidebar but data is kept.`)) return;
    try {
      await $.del(`/api/accounts/${id}`);
      if (this.currentAccountId === id) this.currentAccountId = null;
      await this.loadAccounts(); await this.refreshKPIs();
      toast(`"${name}" archived`, 'success');
      this._renderZeroBal();
    } catch { toast('Archive failed', 'error'); }
  }

  async _deleteFromZeroBal(id, name) {
    if (!confirm(`Permanently delete "${name}" and all its transactions?\nThis cannot be undone.`)) return;
    try {
      await $.del(`/api/accounts/${id}?force=true`);
      if (this.currentAccountId === id) this.currentAccountId = null;
      await this.loadAccounts(); await this.refreshKPIs();
      toast(`"${name}" deleted`, 'success');
      this._renderZeroBal();
    } catch { toast('Delete failed', 'error'); }
  }

  async duplicateAccount(id) {
    try {
      const c = await $.post(`/api/accounts/duplicate/${id}`, {});
      await this.loadAccounts();
      toast(`Duplicated as "${c.name}"`, 'success');
    } catch { toast('Duplicate failed', 'error'); }
  }

  openNotes(id) {
    const txn = this.transactions.find(t => t.id === id);
    if (!txn) return;
    const notes = prompt('Notes:', txn.notes || '');
    if (notes === null) return;
    this._patchTxn(id, { notes });
  }

  scrollToTxn(id) {
    const row = el(`[data-txn-id="${id}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.style.transition = 'background .3s';
    row.style.background = '#fef9c3';
    setTimeout(() => { row.style.background = ''; }, 1600);
  }

  // ── Sidebar Search + Navigation ───────────────────────────────

  _setupSidebarSearch() {
    const inp = el('#sidebar-search-input');
    inp.addEventListener('input', debounce(() => this._renderAccountList(), 200));

    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        // Focus first account item in the list
        const first = el('#account-list .account-item');
        if (first) first.focus();
      }
      if (e.key === 'Escape') { inp.value = ''; this._renderAccountList(); }
    });
  }

  // ── FAB ───────────────────────────────────────────────────────

  _setupFAB() { el('#fab').addEventListener('click', () => this.openQuickAdd()); }

  // ── Undo Bar ──────────────────────────────────────────────────

  _setupUndoBar() {
    el('#undo-bar-btn').addEventListener('click', async () => {
      await this.undoMgr.doUndo(this);
      await this.loadLedger();
      await this.refreshKPIs();
    });
  }

  // ── Global Keyboard Shortcuts ─────────────────────────────────

  _setupGlobalKeys() {
    // ── Keyboard shortcuts ──────────────────────────────────────
    // { capture: true } runs BEFORE browser handles the event, so our
    // shortcuts win over browser defaults (Ctrl+K address bar, etc.).
    // e.stopPropagation() prevents duplicate handlers from firing.
    document.addEventListener('keydown', async e => {
      const ctrl   = e.ctrlKey || e.metaKey;
      const active = document.activeElement;
      const tag    = active?.tagName;
      // inInput: true when typing in a real text/select field
      const inInput = ['INPUT','TEXTAREA','SELECT'].includes(tag)
                      && !active?.classList.contains('form-input-allow-shortcuts');

      // ── Global shortcuts (work from anywhere, override browser) ────────

      // Ctrl+K — Search
      if (ctrl && !e.shiftKey && e.key === 'k') {
        e.preventDefault(); e.stopPropagation();
        this.search.open('all'); return;
      }
      // Ctrl+Shift+S — Summary
      if (ctrl && e.shiftKey && e.key === 'S') {
        e.preventDefault(); e.stopPropagation();
        this.openSummary(); return;
      }
      // Ctrl+Shift+H — Changes
      if (ctrl && e.shiftKey && e.key === 'H') {
        e.preventDefault(); e.stopPropagation();
        this.openChanges(); return;
      }
      // Ctrl+Z — Undo
      if (ctrl && !e.shiftKey && e.key === 'z') {
        if (this.inEdit) return; // let the cell editor handle native undo
        e.preventDefault(); e.stopPropagation();
        await this.undoMgr.doUndo(this); await this.loadLedger(); return;
      }
      // Ctrl+Shift+Z / Ctrl+Y — Redo
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !this.inEdit) {
        e.preventDefault(); e.stopPropagation();
        await this.undoMgr.doRedo(this); await this.loadLedger(); return;
      }

      // Shift+N — Quick Add
      // Allowed from anywhere EXCEPT: inside an active cell edit, or Quick Add already open
      if (e.shiftKey && !ctrl && e.key === 'N'
          && !this.inEdit
          && !el('#quick-add-overlay').classList.contains('open')) {
        e.preventDefault(); e.stopPropagation();
        this.openQuickAdd(); return;
      }

      // Shift+P — Pin / unpin (blocked when typing in an input)
      if (e.shiftKey && !ctrl && e.key === 'P' && !inInput) {
        e.preventDefault(); e.stopPropagation();
        if (this.currentAccountId) await this.togglePin(this.currentAccountId);
        return;
      }

      // Escape — close overlays
      if (e.key === 'Escape') {
        this.closeSummary();
        this.closeChanges();
        this.closeZeroBalance();
        el('#search-overlay').classList.remove('open');
        this.closeQuickAdd();
        this.closeAccountModal();
        el('#ctx-menu').classList.remove('open');
        if (this.inEdit) return; // Esc inside a cell handled by _startEdit
        this.navPos = null;
        els('.nav-focus').forEach(c => c.classList.remove('nav-focus'));
        return;
      }

      // Ctrl+A — Select all rows (blocked when typing)
      if (ctrl && e.key === 'a' && !inInput) {
        e.preventDefault(); e.stopPropagation();
        this.transactions.forEach(t => this.selectedRows.add(t.id));
        els('.row-checkbox').forEach(cb => { cb.checked = true; cb.closest('.ledger-row')?.classList.add('selected'); });
        this._updateSelectionToolbar(); return;
      }

      // Delete — delete selected rows
      if (e.key === 'Delete' && !inInput && this.selectedRows.size > 0 && !this.inEdit) {
        this.bulkAction('delete'); return;
      }

      // Ledger arrow key navigation (only when not editing/in input, ledger visible)
      if (!inInput && !this.inEdit && this.transactions?.length && !el('#search-overlay').classList.contains('open')) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (ctrl) { this._navJump('last'); }
          else       { this._navMove(1, 0); }
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (ctrl) { this._navJump('first'); }
          else       { this._navMove(-1, 0); }
          return;
        }
        if (e.key === 'ArrowRight' && !ctrl) { e.preventDefault(); this._navMove(0, 1); return; }
        if (e.key === 'ArrowLeft'  && !ctrl) { e.preventDefault(); this._navMove(0, -1); return; }

        // Enter / F2 — start editing focused cell
        if ((e.key === 'Enter' || e.key === 'F2') && this.navPos) {
          e.preventDefault();
          this._activateNavCell();
          return;
        }

        // Type a character — start editing focused cell with that char
        if (this.navPos && e.key.length === 1 && !ctrl) {
          const row  = el(`[data-txn-id="${this.navPos.txnId}"]`);
          const cell = row?.querySelector(`[data-field="${this.navPos.field}"]`);
          if (cell) {
            this._startEdit(cell, this.navPos.txnId, this.navPos.field);
            setTimeout(() => {
              const inp = cell.querySelector('.cell-input');
              if (inp) { inp.value = e.key; inp.dispatchEvent(new Event('input', { bubbles: true })); }
            }, 20);
          }
          return;
        }
      }
    }, { capture: true });   // capture = runs before browser's own shortcut handling
  }
}


// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  window.finApp = new FinApp();
});
