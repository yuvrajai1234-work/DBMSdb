/* Shared UI helpers: escaping, icons, badges, formatting, toasts, drawers. */
const S = (value) => String(value ?? '');

export const esc = (value) =>
  S(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 21H3l7.7-7.7a4 4 0 0 0 5-5z"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
  map: '<path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2zM9 3v16M15 5v16"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-2h6.2l1.2 2h1.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/>',
  alert: '<path d="M12 3 2.6 20h18.8L12 3z"/><path d="M12 9v5M12 17.4v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3z"/>',
  lamp: '<circle cx="12" cy="9" r="4.6"/><path d="M12 14v4M9.5 21h5"/>',
  pin: '<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};

export function icon(name, size = 16) {
  const path = ICONS[name] || ICONS.grid;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function statusBadge(status) {
  const map = { Open: 'open', 'In Progress': 'progress', Resolved: 'resolved', Closed: 'resolved' };
  return `<span class="badge ${map[status] || 'neutral'}">${esc(status)}</span>`;
}

export function priorityBadge(priority) {
  const map = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low' };
  return `<span class="badge ${map[priority] || 'neutral'}">${esc(priority)}</span>`;
}

export function subtypeBadge(subtype) {
  if (!subtype) return '<span class="badge neutral plain">Unclassified</span>';
  const cls = subtype === 'Solar' ? 'resolved' : 'progress';
  return `<span class="badge ${cls} plain">${subtype === 'Solar' ? '☀' : '⚡'} ${esc(subtype)}</span>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function asDate(value) {
  if (!value) return null;
  const normalized = S(value).includes('T') ? S(value) : `${S(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fmtDate(value) {
  const date = asDate(value);
  if (!date) return '—';
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function fmtDateTime(value) {
  const date = asDate(value);
  if (!date) return '—';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${fmtDate(value)} · ${hours}:${minutes}`;
}

export function money(value) {
  if (value === null || value === undefined) return '—';
  return `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function initials(name) {
  return S(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysInput(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function toast(message, kind = 'info') {
  const stack = document.getElementById('toasts');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s ease, transform .25s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 260);
  }, 4200);
}

let escapeHandler = null;

export function closeDrawer() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
  }
}

export function openDrawer({ title, kicker = '', body }) {
  const root = document.getElementById('modal-root');
  if (!root) return null;
  root.innerHTML = `
    <div class="modal-backdrop" data-close="1">
      <aside class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <div>
            ${kicker ? `<div class="mono">${esc(kicker)}</div>` : ''}
            <h2>${esc(title)}</h2>
          </div>
          <button class="icon-btn" data-close="1" aria-label="Close" style="margin-left:auto">
            ${icon('close', 18)}
          </button>
        </div>
        <div class="drawer-body">${body}</div>
      </aside>
    </div>`;

  const backdrop = root.querySelector('.modal-backdrop');
  backdrop.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]') && !event.target.closest('.drawer-body')) {
      closeDrawer();
    }
  });
  escapeHandler = (event) => {
    if (event.key === 'Escape') closeDrawer();
  };
  document.addEventListener('keydown', escapeHandler);
  return root.querySelector('.drawer-body');
}

export function emptyState({ title, body, action = '', actionLabel = '' }) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon('lamp', 18)}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
      ${action ? `<button class="btn btn-primary btn-sm" data-action="${esc(action)}">${esc(actionLabel)}</button>` : ''}
    </div>`;
}

export function statCard({ label, value, foot = '', tone = 'amber', id = '' }) {
  return `
    <div class="stat ${tone}" ${id ? `id="${esc(id)}"` : ''}>
      <div class="label">${esc(label)}</div>
      <div class="value">${esc(value)}</div>
      ${foot ? `<div class="foot">${esc(foot)}</div>` : ''}
    </div>`;
}

export function barChart(rows, { empty = 'No data yet.' } = {}) {
  if (!rows || !rows.length) {
    return `<div class="dim tiny" style="padding:10px 0">${esc(empty)}</div>`;
  }
  const max = Math.max(...rows.map((row) => Number(row.count) || 0), 1);
  return `<div class="bars">${rows
    .map(
      (row) => `
      <div class="bar-row">
        <span class="bar-label" title="${esc(row.label)}">${esc(row.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.max(
          4,
          Math.round(((Number(row.count) || 0) / max) * 100),
        )}%"></span></span>
        <span class="bar-value">${Number(row.count) || 0}</span>
      </div>`,
    )
    .join('')}</div>`;
}

export function debounce(fn, wait = 260) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
