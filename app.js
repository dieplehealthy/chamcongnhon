// =====================================================================
// Chấm công của Nhơn — multi-worker, theme, OT, lock, mobile-first
// =====================================================================

const STORAGE_KEY = 'tk_app_v3';
const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DAY_NAMES_LONG = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#6366f1', '#f97316'];

const DEFAULT_SETTINGS = {
  stdHours: 8,
  morningDefault: 4,
  afternoonDefault: 4,
  mode: 'hourly',
  overtimeEnabled: false,
  overtimeRate: 1.5,
  password: '572',
  ownerName: 'Nhơn',
  theme: 'dark'
};

// ---------------- Migration / Storage ----------------
function loadStore() {
  try {
    const v3 = localStorage.getItem(STORAGE_KEY);
    if (v3) {
      const data = JSON.parse(v3);
      return {
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
        workers: Array.isArray(data.workers) ? data.workers : [],
        entries: data.entries || {}
      };
    }
    // migrate v2
    const v2 = localStorage.getItem('tk_app_v2');
    if (v2) {
      const data = JSON.parse(v2);
      return {
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
        workers: Array.isArray(data.workers) ? data.workers : [],
        entries: data.entries || {}
      };
    }
    // migrate v1
    const v1 = localStorage.getItem('tk_app_v1');
    if (v1) {
      const old = JSON.parse(v1);
      const wid = uid();
      return {
        settings: { ...DEFAULT_SETTINGS, ...(old.settings || {}) },
        workers: [{
          id: wid,
          name: (old.settings && old.settings.name) || 'Thợ 1',
          hourly: (old.settings && old.settings.hourly) || 50000,
          daily: (old.settings && old.settings.daily) || 400000,
          color: COLORS[0]
        }],
        entries: { [wid]: old.entries || {} }
      };
    }
  } catch (e) { console.error(e); }
  return { settings: { ...DEFAULT_SETTINGS }, workers: [], entries: {} };
}
function saveStore() { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
function uid() { return 'w_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }

let store = loadStore();

// ---------------- Helpers ----------------
const pad = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const sameDate = (a, b) => fmtDate(a) === fmtDate(b);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  x.setHours(0, 0, 0, 0);
  return x;
}
function fmtMoney(n) { if (!isFinite(n)) n = 0; return Math.round(n).toLocaleString('vi-VN'); }
function fmtHours(n) { if (!isFinite(n)) n = 0; return (Math.round(n * 100) / 100).toLocaleString('vi-VN'); }
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------------- Worker / Entry ----------------
function getWorker(id) { return store.workers.find(w => w.id === id); }
function getEntry(wid, ds) {
  const m = store.entries[wid];
  return (m && m[ds]) ? m[ds] : { morning: 0, afternoon: 0, note: '' };
}
function setEntry(wid, ds, e) {
  if (!store.entries[wid]) store.entries[wid] = {};
  const total = (e.morning || 0) + (e.afternoon || 0);
  if (total === 0 && !e.note) {
    delete store.entries[wid][ds];
    if (Object.keys(store.entries[wid]).length === 0) delete store.entries[wid];
  } else {
    store.entries[wid][ds] = e;
  }
  saveStore();
}

function payBreakdown(worker, hours) {
  const s = store.settings;
  if (hours <= 0) return { regular: 0, overtime: 0, total: 0, otHours: 0 };
  const hourly = worker.hourly || 0;
  const daily = worker.daily || 0;
  const std = s.stdHours;
  const otOn = !!s.overtimeEnabled;
  const otRate = otOn ? (s.overtimeRate || 1) : 1;
  const otHours = otOn && hours > std ? hours - std : 0;
  const baseHours = otOn ? Math.min(hours, std) : hours;

  let regular = 0, overtime = 0;
  switch (s.mode) {
    case 'daily':
      // daily công cho phần base (theo tỉ lệ giờ chuẩn), OT tính theo daily/std × hệ số
      regular = (baseHours / std) * daily;
      if (otHours > 0) overtime = otHours * (daily / std) * otRate;
      break;
    case 'mixed':
      // đủ giờ chuẩn = 1 công, dưới chuẩn tính giờ
      if (baseHours >= std) regular = daily;
      else regular = baseHours * hourly;
      if (otHours > 0) overtime = otHours * hourly * otRate;
      break;
    case 'hourly':
    default:
      regular = baseHours * hourly;
      if (otHours > 0) overtime = otHours * hourly * otRate;
      break;
  }
  return { regular, overtime, total: regular + overtime, otHours };
}
function payForHours(worker, hours) { return payBreakdown(worker, hours).total; }

// ---------------- Theme ----------------
function applyTheme(theme) {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add('theme-' + (theme === 'light' ? 'light' : 'dark'));
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f8fafc' : '#0b1220');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'light' ? '☀' : '🌙';
}
applyTheme(store.settings.theme);

document.getElementById('theme-toggle').addEventListener('click', () => {
  store.settings.theme = store.settings.theme === 'light' ? 'dark' : 'light';
  applyTheme(store.settings.theme);
  saveStore();
  // Re-render charts to pick up new colors
  if (document.getElementById('tab-report').classList.contains('active')) renderReport();
});

// ---------------- Brand / Title ----------------
function applyBrand() {
  const name = (store.settings.ownerName || '').trim();
  const title = name ? `Chấm công của ${name}` : 'Chấm công';
  document.getElementById('brand-text').textContent = title;
  document.getElementById('lock-title').textContent = title;
  document.title = title;
}
applyBrand();

// ---------------- LOCK SCREEN ----------------
const SESSION_KEY = 'tk_unlocked';
function needsLock() {
  const pw = (store.settings.password || '').trim();
  if (!pw) return false;
  return sessionStorage.getItem(SESSION_KEY) !== '1';
}
function showLock() {
  document.getElementById('lock-screen').hidden = false;
  setTimeout(() => document.getElementById('lock-input').focus(), 100);
}
function hideLock() {
  document.getElementById('lock-screen').hidden = true;
  sessionStorage.setItem(SESSION_KEY, '1');
}
function tryUnlock() {
  const v = document.getElementById('lock-input').value;
  const pw = (store.settings.password || '').trim();
  if (v === pw) {
    document.getElementById('lock-error').hidden = true;
    document.getElementById('lock-input').value = '';
    hideLock();
  } else {
    document.getElementById('lock-error').hidden = false;
    const inp = document.getElementById('lock-input');
    inp.value = '';
    inp.focus();
  }
}
document.getElementById('lock-submit').addEventListener('click', tryUnlock);
document.getElementById('lock-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') tryUnlock();
});
if (needsLock()) showLock();

// ---------------- Tabs ----------------
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'today') renderToday();
    if (tab === 'week') renderWeek();
    if (tab === 'month') renderMonth();
    if (tab === 'report') renderReport();
    if (tab === 'settings') renderSettings();
  });
});

// ---------------- TODAY ----------------
let todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);

function renderToday() {
  const list = document.getElementById('today-list');
  const empty = document.getElementById('empty-workers');
  const summary = document.getElementById('today-summary');
  list.innerHTML = '';

  if (store.workers.length === 0) {
    empty.hidden = false; summary.innerHTML = '';
  } else {
    empty.hidden = true;
  }

  const ds = fmtDate(todayDate);
  const isToday = sameDate(todayDate, new Date());
  const dayName = isToday ? 'Hôm nay' : DAY_NAMES_LONG[todayDate.getDay()];
  document.getElementById('today-label').textContent =
    `${dayName} • ${pad(todayDate.getDate())}/${pad(todayDate.getMonth() + 1)}/${todayDate.getFullYear()}`;

  let totalH = 0, totalP = 0, doneCount = 0;
  store.workers.forEach(w => {
    const e = getEntry(w.id, ds);
    const am = e.morning || 0;
    const pm = e.afternoon || 0;
    const h = am + pm;
    const bd = payBreakdown(w, h);
    totalH += h; totalP += bd.total;
    if (h > 0) doneCount++;

    const card = document.createElement('div');
    card.className = 'worker-card';
    card.innerHTML = `
      <div class="worker-avatar" style="background:${w.color}">${initials(w.name)}</div>
      <div class="worker-main">
        <div class="worker-name">${escapeHtml(w.name)}</div>
        <div class="shift-row">
          <button class="shift-btn am ${am > 0 ? 'on' : ''}" data-wid="${w.id}" data-shift="morning">
            <span class="label">Sáng</span>
            <span class="hours">${am > 0 ? fmtHours(am) + ' giờ' : 'Tap để chấm'}</span>
            <span class="check">✓</span>
          </button>
          <button class="shift-btn pm ${pm > 0 ? 'on' : ''}" data-wid="${w.id}" data-shift="afternoon">
            <span class="label">Chiều</span>
            <span class="hours">${pm > 0 ? fmtHours(pm) + ' giờ' : 'Tap để chấm'}</span>
            <span class="check">✓</span>
          </button>
        </div>
        <div class="worker-totals">
          <span>Tổng: <span class="strong">${fmtHours(h)} giờ</span>${bd.otHours > 0 ? ` <span class="ot">(+${fmtHours(bd.otHours)}h tăng ca)</span>` : ''}</span>
          <span>Lương: <span class="strong">${fmtMoney(bd.total)} ₫</span></span>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  // Bind shift buttons
  list.querySelectorAll('.shift-btn').forEach(btn => {
    let pressTimer = null, longPressed = false;
    const startPress = () => {
      longPressed = false;
      pressTimer = setTimeout(() => { longPressed = true; openShiftEditor(btn); }, 500);
    };
    const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
    btn.addEventListener('pointerdown', startPress);
    btn.addEventListener('pointerup', cancelPress);
    btn.addEventListener('pointerleave', cancelPress);
    btn.addEventListener('pointercancel', cancelPress);
    btn.addEventListener('click', (ev) => {
      if (longPressed) { ev.preventDefault(); return; }
      tapShift(btn);
    });
  });

  if (store.workers.length > 0) {
    summary.innerHTML = `
      <div class="stat"><div class="lbl">Đã chấm</div><div class="val">${doneCount}/${store.workers.length}</div></div>
      <div class="stat"><div class="lbl">Tổng giờ</div><div class="val">${fmtHours(totalH)}</div></div>
      <div class="stat"><div class="lbl">Tổng lương</div><div class="val amber">${fmtMoney(totalP)} ₫</div></div>
    `;
  }
}

function tapShift(btn) {
  const wid = btn.dataset.wid;
  const shift = btn.dataset.shift;
  const ds = fmtDate(todayDate);
  const e = { ...getEntry(wid, ds) };
  const cur = e[shift] || 0;
  const def = shift === 'morning' ? store.settings.morningDefault : store.settings.afternoonDefault;
  const w = getWorker(wid);
  const shiftName = shift === 'morning' ? 'Sáng' : 'Chiều';

  if (cur > 0) {
    // Confirmation: cancel or change
    confirmDialog({
      title: `Đã chấm ${shiftName} (${fmtHours(cur)} giờ)`,
      message: `${w.name} đã chấm ca ${shiftName.toLowerCase()} với ${fmtHours(cur)} giờ. Bạn muốn làm gì?`,
      actions: [
        { label: 'Để nguyên', cls: 'secondary', onClick: closeModal },
        { label: 'Sửa số giờ', cls: 'secondary', onClick: () => { closeModal(); openShiftEditor(btn); } },
        { label: 'Huỷ ca', cls: 'danger', onClick: () => {
          e[shift] = 0;
          setEntry(wid, ds, e);
          closeModal();
          renderToday();
          toast('Đã huỷ ca ' + shiftName.toLowerCase());
        } }
      ]
    });
  } else {
    // First time tap: silent set default
    e[shift] = def;
    setEntry(wid, ds, e);
    renderToday();
  }
}

function openShiftEditor(btn) {
  const wid = btn.dataset.wid;
  const shift = btn.dataset.shift;
  const ds = btn.dataset.date || fmtDate(todayDate);
  const e = { ...getEntry(wid, ds) };
  const w = getWorker(wid);
  const cur = e[shift] || 0;
  openModal({
    title: `${w.name} • ${shift === 'morning' ? 'Sáng' : 'Chiều'}`,
    bodyHtml: `
      <label>Số giờ
        <input type="number" id="ed-hours" min="0" max="12" step="0.5" value="${cur}" inputmode="decimal" />
      </label>
      <label>Ghi chú (tuỳ chọn)
        <input type="text" id="ed-note" value="${escapeAttr(e.note || '')}" placeholder="VD: làm việc tại site A..." />
      </label>
    `,
    actions: [
      ...(cur > 0 ? [{ label: 'Huỷ ca', cls: 'danger', onClick: () => {
        e[shift] = 0; setEntry(wid, ds, e); closeModal(); renderToday(); renderWeek(); renderMonth();
      } }] : []),
      { label: 'Đóng', cls: 'secondary', onClick: closeModal },
      { label: 'Lưu', cls: 'primary', onClick: () => {
        let v = parseFloat(document.getElementById('ed-hours').value) || 0;
        if (v < 0) v = 0; if (v > 12) v = 12;
        e[shift] = v;
        e.note = document.getElementById('ed-note').value.trim();
        setEntry(wid, ds, e);
        closeModal();
        renderToday(); renderWeek(); renderMonth();
      } }
    ]
  });
}

document.getElementById('prev-day').addEventListener('click', () => { todayDate = addDays(todayDate, -1); renderToday(); });
document.getElementById('next-day').addEventListener('click', () => { todayDate = addDays(todayDate, 1); renderToday(); });
document.getElementById('jump-today').addEventListener('click', () => { todayDate = new Date(); todayDate.setHours(0,0,0,0); renderToday(); });
document.getElementById('empty-add-worker').addEventListener('click', () => openWorkerEditor(null));

// ---------------- WEEK (card-based, no overflow) ----------------
let weekStart = startOfWeek(new Date());

function renderWeek() {
  const sel = document.getElementById('week-worker');
  const prev = sel.value;
  sel.innerHTML = store.workers.length
    ? store.workers.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('')
    : '<option value="">— chưa có thợ —</option>';
  if (store.workers.find(w => w.id === prev)) sel.value = prev;

  const wid = sel.value;
  const w = wid ? getWorker(wid) : null;
  const cards = document.getElementById('week-cards');
  cards.innerHTML = '';
  let totalH = 0, totalP = 0;
  const today = new Date();

  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const ds = fmtDate(d);
    const e = wid ? getEntry(wid, ds) : { morning: 0, afternoon: 0 };
    const am = e.morning || 0, pm = e.afternoon || 0;
    const h = am + pm;
    const bd = w ? payBreakdown(w, h) : { total: 0, otHours: 0 };
    totalH += h; totalP += bd.total;

    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = sameDate(d, today);

    const card = document.createElement('div');
    card.className = 'worker-card';
    card.innerHTML = `
      <div class="worker-avatar" style="background:${isToday ? 'var(--primary)' : (isWeekend ? '#3b82f6' : '#64748b')}">
        ${pad(d.getDate())}
      </div>
      <div class="worker-main">
        <div class="worker-name">${DAY_NAMES_LONG[d.getDay()]} ${isToday ? '• Hôm nay' : ''}</div>
        <div class="shift-row">
          <button class="shift-btn am ${am > 0 ? 'on' : ''}" data-wid="${wid}" data-date="${ds}" data-shift="morning">
            <span class="label">Sáng</span>
            <span class="hours">${am > 0 ? fmtHours(am) + ' giờ' : 'Tap để chấm'}</span>
            <span class="check">✓</span>
          </button>
          <button class="shift-btn pm ${pm > 0 ? 'on' : ''}" data-wid="${wid}" data-date="${ds}" data-shift="afternoon">
            <span class="label">Chiều</span>
            <span class="hours">${pm > 0 ? fmtHours(pm) + ' giờ' : 'Tap để chấm'}</span>
            <span class="check">✓</span>
          </button>
        </div>
        <div class="worker-totals">
          <span>Tổng: <span class="strong">${fmtHours(h)} giờ</span>${bd.otHours > 0 ? ` <span class="ot">(+${fmtHours(bd.otHours)}h)</span>` : ''}</span>
          <span>Lương: <span class="strong">${fmtMoney(bd.total)} ₫</span></span>
        </div>
      </div>
    `;
    cards.appendChild(card);
  }

  document.getElementById('week-h').textContent = fmtHours(totalH) + ' giờ';
  document.getElementById('week-p').textContent = fmtMoney(totalP) + ' ₫';
  const end = addDays(weekStart, 6);
  document.getElementById('week-label').textContent =
    `${pad(weekStart.getDate())}/${pad(weekStart.getMonth()+1)} → ${pad(end.getDate())}/${pad(end.getMonth()+1)}`;

  // bind shift buttons (with confirmation)
  cards.querySelectorAll('.shift-btn').forEach(btn => {
    if (!btn.dataset.wid) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      return;
    }
    let pressTimer = null, longPressed = false;
    btn.addEventListener('pointerdown', () => {
      longPressed = false;
      pressTimer = setTimeout(() => { longPressed = true; openShiftEditor(btn); }, 500);
    });
    const cancel = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
    btn.addEventListener('pointerup', cancel);
    btn.addEventListener('pointerleave', cancel);
    btn.addEventListener('pointercancel', cancel);
    btn.addEventListener('click', (ev) => {
      if (longPressed) { ev.preventDefault(); return; }
      tapShiftWeek(btn);
    });
  });
}

function tapShiftWeek(btn) {
  const wid = btn.dataset.wid;
  const ds = btn.dataset.date;
  const shift = btn.dataset.shift;
  const e = { ...getEntry(wid, ds) };
  const cur = e[shift] || 0;
  const def = shift === 'morning' ? store.settings.morningDefault : store.settings.afternoonDefault;
  const w = getWorker(wid);
  const shiftName = shift === 'morning' ? 'Sáng' : 'Chiều';
  if (cur > 0) {
    confirmDialog({
      title: `${ds} • ${shiftName} (${fmtHours(cur)} giờ)`,
      message: `Đã chấm ca này. Bạn muốn làm gì?`,
      actions: [
        { label: 'Để nguyên', cls: 'secondary', onClick: closeModal },
        { label: 'Sửa số giờ', cls: 'secondary', onClick: () => { closeModal(); openShiftEditor(btn); } },
        { label: 'Huỷ ca', cls: 'danger', onClick: () => {
          e[shift] = 0; setEntry(wid, ds, e); closeModal(); renderWeek();
          toast('Đã huỷ ca ' + shiftName.toLowerCase());
        } }
      ]
    });
  } else {
    e[shift] = def;
    setEntry(wid, ds, e);
    renderWeek();
  }
}

document.getElementById('prev-week').addEventListener('click', () => { weekStart = addDays(weekStart, -7); renderWeek(); });
document.getElementById('next-week').addEventListener('click', () => { weekStart = addDays(weekStart, 7); renderWeek(); });
document.getElementById('week-worker').addEventListener('change', renderWeek);

// ---------------- MONTH ----------------
let monthDate = new Date(); monthDate.setDate(1);

function renderMonth() {
  const sel = document.getElementById('month-worker');
  const prev = sel.value;
  sel.innerHTML = `<option value="__all__">Tất cả thợ</option>` +
    store.workers.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
  if (prev) sel.value = prev;

  const target = sel.value;
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth();
  const dim = daysInMonth(y, m);
  document.getElementById('month-label').textContent = `Tháng ${pad(m+1)}/${y}`;

  const content = document.getElementById('month-content');
  content.innerHTML = '';

  const workersToShow = target === '__all__' ? store.workers : store.workers.filter(w => w.id === target);
  let grandH = 0, grandP = 0, daysSet = new Set();

  workersToShow.forEach(w => {
    let wH = 0, wP = 0, wD = 0, wOT = 0;
    const cells = [];
    const first = new Date(y, m, 1);
    const startPad = first.getDay() === 0 ? 6 : first.getDay() - 1;
    for (let i = 0; i < startPad; i++) cells.push(`<div class="month-cell empty"></div>`);
    for (let i = 1; i <= dim; i++) {
      const d = new Date(y, m, i);
      const ds = fmtDate(d);
      const e = getEntry(w.id, ds);
      const h = (e.morning || 0) + (e.afternoon || 0);
      const bd = payBreakdown(w, h);
      wH += h; wP += bd.total; wOT += bd.otHours;
      if (h > 0) { wD++; daysSet.add(ds); }
      let cls = 'month-cell';
      if (h >= store.settings.stdHours) cls += ' full';
      else if (h > 0) cls += ' has';
      cells.push(`<div class="${cls}" title="${ds}: ${fmtHours(h)}h">${i}<span style="font-size:9px;">${h > 0 ? fmtHours(h) : ''}</span></div>`);
    }
    grandH += wH; grandP += wP;

    const block = document.createElement('div');
    block.className = 'month-worker-block';
    block.innerHTML = `
      <div class="h">
        <span class="av" style="background:${w.color}">${initials(w.name)}</span>
        <span class="nm">${escapeHtml(w.name)}</span>
        <span class="pay">${fmtMoney(wP)} ₫</span>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">
        ${wD} ngày • ${fmtHours(wH)} giờ${wOT > 0 ? ` • ${fmtHours(wOT)}h tăng ca` : ''}
      </div>
      <div class="month-grid">
        ${['T2','T3','T4','T5','T6','T7','CN'].map(d => `<div style="text-align:center;font-size:10px;color:var(--text-dim);">${d}</div>`).join('')}
        ${cells.join('')}
      </div>
    `;
    content.appendChild(block);
  });

  document.getElementById('m-days').textContent = daysSet.size;
  document.getElementById('m-hours').textContent = fmtHours(grandH);
  document.getElementById('m-pay').textContent = fmtMoney(grandP) + ' ₫';

  if (workersToShow.length === 0) {
    content.innerHTML = `<p class="hint">Chưa có thợ. Vào tab <b>Cài đặt</b> để thêm.</p>`;
  }
}

document.getElementById('prev-month').addEventListener('click', () => { monthDate = addMonths(monthDate, -1); renderMonth(); });
document.getElementById('next-month').addEventListener('click', () => { monthDate = addMonths(monthDate, 1); renderMonth(); });
document.getElementById('month-worker').addEventListener('change', renderMonth);

// ---------------- REPORT ----------------
let chartHours = null, chartPay = null, chartByWorker = null;

function getYearsWithData() {
  const years = new Set();
  Object.values(store.entries).forEach(map => Object.keys(map).forEach(k => years.add(k.slice(0, 4))));
  years.add(String(new Date().getFullYear()));
  return [...years].sort();
}

function renderReport() {
  const ySel = document.getElementById('report-year');
  const wSel = document.getElementById('report-worker');
  const years = getYearsWithData();
  const py = ySel.value;
  ySel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  ySel.value = years.includes(py) ? py : String(new Date().getFullYear());

  const pw = wSel.value;
  wSel.innerHTML = `<option value="__all__">Tất cả</option>` +
    store.workers.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
  if (pw) wSel.value = pw;

  drawCharts(parseInt(ySel.value, 10), wSel.value);
}

document.addEventListener('change', (e) => {
  if (e.target && (e.target.id === 'report-year' || e.target.id === 'report-worker')) {
    drawCharts(parseInt(document.getElementById('report-year').value, 10), document.getElementById('report-worker').value);
  }
});

function drawCharts(year, who) {
  const labels = Array.from({ length: 12 }, (_, i) => 'T' + (i + 1));
  const monthHours = Array(12).fill(0);
  const monthPay = Array(12).fill(0);

  const targets = who === '__all__' ? store.workers : store.workers.filter(w => w.id === who);
  targets.forEach(w => {
    const map = store.entries[w.id] || {};
    Object.entries(map).forEach(([ds, e]) => {
      if (!ds.startsWith(year + '-')) return;
      const m = parseInt(ds.slice(5, 7), 10) - 1;
      const h = (e.morning || 0) + (e.afternoon || 0);
      monthHours[m] += h;
      monthPay[m] += payForHours(w, h);
    });
  });

  const isLight = store.settings.theme === 'light';
  const accent = isLight ? '#d97706' : '#f59e0b';
  const grid = isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.06)';
  const tick = isLight ? '#475569' : '#8aa0c2';
  Chart.defaults.color = tick;
  Chart.defaults.borderColor = grid;

  if (chartHours) chartHours.destroy();
  chartHours = new Chart(document.getElementById('chart-hours'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Giờ', data: monthHours, backgroundColor: accent, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { x: { grid: { color: grid } }, y: { grid: { color: grid } } } }
  });

  if (chartPay) chartPay.destroy();
  chartPay = new Chart(document.getElementById('chart-pay'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Lương', data: monthPay, borderColor: accent, backgroundColor: isLight ? 'rgba(217,119,6,0.18)' : 'rgba(245,158,11,0.2)', fill: true, tension: 0.3, pointRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { color: grid } }, y: { grid: { color: grid }, ticks: { callback: v => v.toLocaleString('vi-VN') } } }
    }
  });

  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth();
  const wlabels = [], wdata = [], wcolors = [];
  store.workers.forEach(w => {
    const map = store.entries[w.id] || {};
    let p = 0;
    Object.entries(map).forEach(([ds, e]) => {
      if (parseInt(ds.slice(0, 4), 10) === cy && parseInt(ds.slice(5, 7), 10) - 1 === cm) {
        p += payForHours(w, (e.morning || 0) + (e.afternoon || 0));
      }
    });
    wlabels.push(w.name); wdata.push(p); wcolors.push(w.color);
  });

  if (chartByWorker) chartByWorker.destroy();
  chartByWorker = new Chart(document.getElementById('chart-by-worker'), {
    type: 'bar',
    data: { labels: wlabels, datasets: [{ data: wdata, backgroundColor: wcolors, borderRadius: 6 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { color: grid }, ticks: { callback: v => v.toLocaleString('vi-VN') } }, y: { grid: { color: grid } } }
    }
  });
}

// ---------------- SETTINGS ----------------
function renderSettings() {
  // Workers list
  const list = document.getElementById('workers-list');
  list.innerHTML = '';
  if (store.workers.length === 0) {
    list.innerHTML = `<p class="hint">Chưa có thợ. Bấm <b>+ Thêm</b> để bắt đầu.</p>`;
  }
  store.workers.forEach(w => {
    const row = document.createElement('div');
    row.className = 'worker-row';
    row.innerHTML = `
      <div class="worker-avatar" style="background:${w.color}">${initials(w.name)}</div>
      <div class="meta">
        <div class="name">${escapeHtml(w.name)}</div>
        <div class="rate">${fmtMoney(w.hourly)}₫/giờ • ${fmtMoney(w.daily)}₫/công</div>
      </div>
      <div class="row-actions">
        <button class="secondary" data-edit="${w.id}">Sửa</button>
        <button class="danger" data-del="${w.id}">Xoá</button>
      </div>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openWorkerEditor(b.dataset.edit)));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteWorker(b.dataset.del)));

  // Settings form
  const s = store.settings;
  document.getElementById('cfg-owner').value = s.ownerName || '';
  document.getElementById('cfg-theme').value = s.theme || 'dark';
  document.getElementById('cfg-std-hours').value = s.stdHours;
  document.getElementById('cfg-morning').value = s.morningDefault;
  document.getElementById('cfg-afternoon').value = s.afternoonDefault;
  document.getElementById('cfg-mode').value = s.mode;
  document.getElementById('cfg-ot-enabled').checked = !!s.overtimeEnabled;
  document.getElementById('cfg-ot-rate').value = s.overtimeRate;
  document.getElementById('cfg-password').value = s.password || '';
  document.getElementById('cfg-password2').value = s.password || '';
}

function openWorkerEditor(wid) {
  const w = wid ? getWorker(wid) : null;
  const used = store.workers.map(x => x.color);
  const defaultColor = w ? w.color : (COLORS.find(c => !used.includes(c)) || COLORS[0]);
  const swatches = COLORS.map(c =>
    `<div class="color-swatch ${c === defaultColor ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`
  ).join('');
  openModal({
    title: w ? 'Sửa thợ' : 'Thêm thợ',
    bodyHtml: `
      <label>Tên thợ
        <input type="text" id="w-name" value="${w ? escapeAttr(w.name) : ''}" placeholder="VD: Nguyễn Văn A" />
      </label>
      <label>Lương theo giờ (VNĐ)
        <input type="number" id="w-hourly" min="0" step="1000" inputmode="decimal" value="${w ? w.hourly : 50000}" />
      </label>
      <label>Lương ngày công (VNĐ)
        <input type="number" id="w-daily" min="0" step="1000" inputmode="decimal" value="${w ? w.daily : 400000}" />
      </label>
      <label>Màu nhận diện
        <div class="color-swatches" id="w-colors">${swatches}</div>
        <input type="hidden" id="w-color" value="${defaultColor}" />
      </label>
    `,
    actions: [
      { label: 'Huỷ', cls: 'secondary', onClick: closeModal },
      { label: w ? 'Lưu' : 'Thêm', cls: 'primary', onClick: () => {
        const name = document.getElementById('w-name').value.trim();
        if (!name) { alert('Vui lòng nhập tên'); return; }
        const hourly = parseFloat(document.getElementById('w-hourly').value) || 0;
        const daily = parseFloat(document.getElementById('w-daily').value) || 0;
        const color = document.getElementById('w-color').value;
        if (w) { w.name = name; w.hourly = hourly; w.daily = daily; w.color = color; }
        else { store.workers.push({ id: uid(), name, hourly, daily, color }); }
        saveStore();
        closeModal();
        renderSettings(); renderToday(); renderWeek(); renderMonth(); renderReport();
      } }
    ],
    onOpen: () => {
      const cont = document.getElementById('w-colors');
      cont.querySelectorAll('.color-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          cont.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
          sw.classList.add('selected');
          document.getElementById('w-color').value = sw.dataset.color;
        });
      });
    }
  });
}

function deleteWorker(wid) {
  const w = getWorker(wid);
  if (!w) return;
  if (!confirm(`Xoá thợ "${w.name}" và toàn bộ dữ liệu chấm công của thợ này?`)) return;
  store.workers = store.workers.filter(x => x.id !== wid);
  delete store.entries[wid];
  saveStore();
  renderSettings(); renderToday(); renderWeek(); renderMonth(); renderReport();
}

document.getElementById('add-worker').addEventListener('click', () => openWorkerEditor(null));

document.getElementById('save-settings').addEventListener('click', () => {
  const pw1 = document.getElementById('cfg-password').value;
  const pw2 = document.getElementById('cfg-password2').value;
  if (pw1 !== pw2) { alert('Mật khẩu xác nhận không khớp'); return; }

  const newOwner = document.getElementById('cfg-owner').value.trim();
  const newTheme = document.getElementById('cfg-theme').value;

  store.settings = {
    ...store.settings,
    ownerName: newOwner,
    theme: newTheme,
    stdHours: parseFloat(document.getElementById('cfg-std-hours').value) || 8,
    morningDefault: parseFloat(document.getElementById('cfg-morning').value) || 0,
    afternoonDefault: parseFloat(document.getElementById('cfg-afternoon').value) || 0,
    mode: document.getElementById('cfg-mode').value,
    overtimeEnabled: document.getElementById('cfg-ot-enabled').checked,
    overtimeRate: parseFloat(document.getElementById('cfg-ot-rate').value) || 1.5,
    password: pw1
  };
  saveStore();
  applyTheme(newTheme);
  applyBrand();
  renderToday(); renderWeek(); renderMonth(); renderReport();
  toast('Đã lưu cài đặt');
});

document.getElementById('reset-data').addEventListener('click', () => {
  if (!confirm('Xoá TOÀN BỘ thợ + dữ liệu chấm công + cài đặt?')) return;
  if (!confirm('Bạn chắc chắn chứ? Hành động không thể hoàn tác.')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('tk_app_v2');
  localStorage.removeItem('tk_app_v1');
  sessionStorage.removeItem(SESSION_KEY);
  store = loadStore();
  applyTheme(store.settings.theme);
  applyBrand();
  renderSettings(); renderToday(); renderWeek(); renderMonth(); renderReport();
  if (needsLock()) showLock();
});

// ---------------- EXPORT / IMPORT ----------------
document.getElementById('export-csv').addEventListener('click', () => {
  const rows = [['Thợ', 'Ngày', 'Thứ', 'Sáng (giờ)', 'Chiều (giờ)', 'Tổng giờ', 'Tăng ca (giờ)', 'Lương thường', 'Lương tăng ca', 'Tổng lương', 'Ghi chú']];
  store.workers.forEach(w => {
    const map = store.entries[w.id] || {};
    Object.keys(map).sort().forEach(ds => {
      const e = map[ds];
      const d = parseDate(ds);
      const h = (e.morning || 0) + (e.afternoon || 0);
      const bd = payBreakdown(w, h);
      rows.push([w.name, ds, DAY_NAMES_LONG[d.getDay()], e.morning || 0, e.afternoon || 0, h, bd.otHours, Math.round(bd.regular), Math.round(bd.overtime), Math.round(bd.total), (e.note || '').replace(/"/g, '""')]);
    });
  });
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  download(csv, `cham-cong-${(store.settings.ownerName || 'data').replace(/\s+/g, '-')}-${fmtDate(new Date())}.csv`, 'text/csv;charset=utf-8;');
});

document.getElementById('export-json').addEventListener('click', () => {
  const payload = {
    app: 'cham-cong-cua-nhon',
    version: 3,
    exportedAt: new Date().toISOString(),
    ...store
  };
  download(JSON.stringify(payload, null, 2), `cham-cong-backup-${fmtDate(new Date())}.json`, 'application/json');
});

document.getElementById('import-json').addEventListener('change', (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data.workers && !data.entries && !data.settings) throw new Error('File không đúng định dạng sao lưu.');
      if (!confirm('Nhập dữ liệu sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại. Tiếp tục?')) return;
      store = {
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
        workers: Array.isArray(data.workers) ? data.workers : [],
        entries: data.entries || {}
      };
      saveStore();
      applyTheme(store.settings.theme);
      applyBrand();
      renderSettings(); renderToday(); renderWeek(); renderMonth(); renderReport();
      toast('Đã nhập dữ liệu thành công');
    } catch (e) { alert('Lỗi: ' + e.message); }
  };
  r.readAsText(file);
  ev.target.value = '';
});

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

// ---------------- MODAL ----------------
function openModal({ title, bodyHtml, actions, onOpen }) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  const ac = document.getElementById('modal-actions');
  ac.innerHTML = '';
  actions.forEach(a => {
    const b = document.createElement('button');
    b.className = a.cls || '';
    b.textContent = a.label;
    b.addEventListener('click', a.onClick);
    ac.appendChild(b);
  });
  document.getElementById('modal-backdrop').hidden = false;
  if (onOpen) onOpen();
}
function closeModal() { document.getElementById('modal-backdrop').hidden = true; }
function confirmDialog({ title, message, actions }) {
  openModal({
    title,
    bodyHtml: `<p style="margin:0;color:var(--text-dim);font-size:14px;line-height:1.5;">${escapeHtml(message)}</p>`,
    actions
  });
}
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});

// ---------------- TOAST ----------------
function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', left: '50%', bottom: '90px', transform: 'translateX(-50%)',
    background: 'var(--surface)', color: 'var(--text)', padding: '10px 16px',
    borderRadius: '20px', border: '1px solid var(--primary)', zIndex: 200,
    fontSize: '14px', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

// ---------------- ESCAPE ----------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------------- BOOT ----------------
renderToday();
