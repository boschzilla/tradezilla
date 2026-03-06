// ── State ─────────────────────────────────────────────────────────────────────

const MOD_TYPES = ['explicitMods', 'implicitMods', 'craftedMods', 'enchantMods', 'fracturedMods'];

// Map of normalized affix label → { count, rawSamples: Set, values: number[], listingIds: string[], prices: [] }
const affixMap = new Map();
// Per-item data: listingId → { name, baseType, ilvl, price, mods: Map<normKey, rawString> }
const itemMap = new Map();
// Insertion-order list of listing IDs
const listingOrder = [];
// Cursor: tracks which item index to show next per affix key
const affixCursor = new Map();
let totalItems = 0;
let tableViewActive = false;
let tableSort = { key: null, dir: 'asc' };
let panelCollapsed = true;

// ── Normalization ─────────────────────────────────────────────────────────────

function normalizeAffix(raw) {
  return raw
    .replace(/[+-]?\d+(\.\d+)?/g, '#')
    .replace(/^#\s+/, '# ')
    .trim();
}

function extractNumbers(raw) {
  const matches = raw.match(/[+-]?\d+(\.\d+)?/g);
  return matches ? matches.map(Number) : [];
}

// ── Data ingestion ────────────────────────────────────────────────────────────

function processItems(results) {
  if (!Array.isArray(results)) return;

  for (const entry of results) {
    const item = entry?.item;
    if (!item) continue;
    totalItems++;

    const listingId = entry.id ?? null;
    if (listingId) listingOrder.push(listingId);

    const price = entry?.listing?.price ?? null;
    const itemMods = new Map(); // normKey → raw string (for per-item table)

    for (const modType of MOD_TYPES) {
      const mods = item[modType];
      if (!Array.isArray(mods)) continue;

      for (const raw of mods) {
        const key = normalizeAffix(raw);
        itemMods.set(key, raw);

        if (!affixMap.has(key)) {
          affixMap.set(key, { count: 0, rawSamples: new Set(), values: [], listingIds: [], prices: [] });
        }
        const data = affixMap.get(key);
        data.count++;
        data.rawSamples.add(raw);
        data.values.push(...extractNumbers(raw));
        if (listingId) data.listingIds.push(listingId);
        if (price?.amount != null && price?.currency) data.prices.push(price);
      }
    }

    if (listingId) {
      itemMap.set(listingId, {
        name: item.name || '',
        baseType: item.baseType || item.typeLine || '',
        ilvl: item.ilvl ?? '?',
        price,
        mods: itemMods,
      });
    }
  }

  renderPanel();

  if (tableViewActive) {
    updateItemTable();
  }
}

// ── Table view ────────────────────────────────────────────────────────────────

function toggleTableView() {
  tableViewActive = !tableViewActive;
  const btn = document.getElementById('poe-table-toggle');
  if (btn) btn.textContent = tableViewActive ? '⊟ Cards' : '⊞ Table';
  syncInjectedBtn();

  const resultsEl = findResultsContainer();
  const existing = document.getElementById('poe-item-table-overlay');

  if (tableViewActive) {
    if (resultsEl) resultsEl.style.visibility = 'hidden';
    if (existing) {
      existing.style.display = '';
    } else {
      const overlay = document.createElement('div');
      overlay.id = 'poe-item-table-overlay';
      overlay.innerHTML = `
        <div id="poe-item-table-wrap">
          <table id="poe-item-table">
            <thead id="poe-item-thead"><tr></tr></thead>
            <tbody id="poe-item-tbody"></tbody>
          </table>
          <div id="poe-table-footer">▲ click to return to card view</div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#poe-table-footer').addEventListener('click', toggleTableView);
    }
    renderItemTable();
  } else {
    if (resultsEl) resultsEl.style.visibility = '';
    if (existing) existing.style.display = 'none';
  }
}

function findResultsContainer() {
  for (const sel of ['.resultset', '#results', '[class*="resultset"]']) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  const items = document.querySelectorAll('.row[class*="item"], section.row, div.row');
  return items[0]?.parentElement ?? null;
}

function getAffixCols() {
  return [...affixMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 25)
    .map(([key]) => key);
}

function getSortValue(item, key) {
  if (key === '__name')  return (item.name || item.baseType || '').toLowerCase();
  if (key === '__price') return item.price?.amount ?? Infinity;
  if (key === '__ilvl')  return Number(item.ilvl) || 0;
  const raw = item.mods.get(key);
  if (!raw) return null; // null = missing → always sorts last
  const nums = raw.match(/[+-]?\d+(\.\d+)?/g);
  return nums ? parseFloat(nums[0]) : 0;
}

function sortedListingOrder() {
  const { key, dir } = tableSort;
  if (!key) return [...listingOrder];
  const mul = dir === 'asc' ? 1 : -1;
  return [...listingOrder].sort((a, b) => {
    const va = getSortValue(itemMap.get(a) ?? {}, key);
    const vb = getSortValue(itemMap.get(b) ?? {}, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;   // missing → last
    if (vb === null) return -1;
    if (typeof va === 'string') return va.localeCompare(vb) * mul;
    return (va - vb) * mul;
  });
}

function renderItemTable() {
  const thead = document.getElementById('poe-item-thead');
  const tbody = document.getElementById('poe-item-tbody');
  if (!thead || !tbody) return;

  const affixCols = getAffixCols();
  const { key: sortKey, dir: sortDir } = tableSort;

  const fixedCols = [
    { key: '__name',  label: 'Item' },
    { key: '__price', label: 'Price' },
    { key: '__ilvl',  label: 'iLvl' },
  ];

  const makeThHtml = (key, label, title) => {
    const isActive = sortKey === key;
    const indicator = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="poe-tbl-th${isActive ? ' poe-tbl-sorted' : ''}" data-col="${escHtml(key)}" title="${escHtml(title ?? label)}">${escHtml(label)}${indicator}</th>`;
  };

  thead.innerHTML = `<tr>
    ${fixedCols.map(c => makeThHtml(c.key, c.label)).join('')}
    ${affixCols.map(k => makeThHtml(k, k, k)).join('')}
  </tr>`;

  // Wire sort clicks
  thead.querySelectorAll('.poe-tbl-th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (tableSort.key === col) {
        tableSort.dir = tableSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        tableSort.key = col;
        tableSort.dir = 'asc';
      }
      renderItemTable();
    });
  });

  tbody.innerHTML = '';
  for (const id of sortedListingOrder()) appendItemRow(id, affixCols);
}

function updateItemTable() {
  if (!document.getElementById('poe-item-tbody')) return;
  // Full re-render to keep sort order correct and handle new columns
  renderItemTable();
}

function appendItemRow(id, affixCols) {
  const tbody = document.getElementById('poe-item-tbody');
  if (!tbody) return;
  const item = itemMap.get(id);
  if (!item) return;

  const priceStr = item.price
    ? `${item.price.amount} ${CURRENCY_SHORT[item.price.currency] ?? item.price.currency}`
    : '—';

  const tr = document.createElement('tr');
  tr.dataset.id = id;
  tr.innerHTML = `
    <td class="poe-tbl-name" title="${escHtml((item.name + ' ' + item.baseType).trim())}">${escHtml(item.name || item.baseType)}<br><span class="poe-tbl-base">${escHtml(item.baseType)}</span></td>
    <td class="poe-tbl-price">${escHtml(priceStr)}</td>
    <td class="poe-tbl-ilvl">${item.ilvl}</td>
    ${affixCols.map(k => {
      const raw = item.mods.get(k);
      return raw
        ? `<td class="poe-tbl-mod has" title="${escHtml(raw)}">${escHtml(modShortValue(raw))}</td>`
        : '<td class="poe-tbl-mod">—</td>';
    }).join('')}`;

  // Hover preview on name cell
  const nameCell = tr.querySelector('.poe-tbl-name');
  nameCell.addEventListener('mouseenter', (e) => showItemPreview(id, e.clientX, e.clientY));
  nameCell.addEventListener('mousemove',  (e) => {
    const preview = document.getElementById('poe-item-preview');
    if (preview?.style.display !== 'none') positionPreview(preview, e.clientX, e.clientY);
  });
  nameCell.addEventListener('mouseleave', hideItemPreview);

  tr.addEventListener('click', () => {
    hideItemPreview();
    toggleTableView();
    setTimeout(() => {
      const el = document.querySelector(`[data-id="${id}"]`) ?? findItemByIndex(listingOrder.indexOf(id));
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); flashElement(el); }
    }, 150);
  });

  tbody.appendChild(tr);
}

// Extract just the numeric part(s) from a raw mod for compact display
function modShortValue(raw) {
  const nums = raw.match(/[+-]?\d+(\.\d+)?/g);
  return nums ? nums.join('/') : raw.slice(0, 18);
}

// ── Item card preview on hover ────────────────────────────────────────────────

function initItemPreview() {
  if (document.getElementById('poe-item-preview')) return;
  const el = document.createElement('div');
  el.id = 'poe-item-preview';
  document.body.appendChild(el);
}

function showItemPreview(id, clientX, clientY) {
  const preview = document.getElementById('poe-item-preview');
  if (!preview) return;

  // Find the original card (it's visibility:hidden but still in the DOM)
  const card = document.querySelector(`[data-id="${id}"]`)
    ?? findItemByIndex(listingOrder.indexOf(id));

  if (!card) { preview.style.display = 'none'; return; }

  // Only re-clone if item changed
  if (preview.dataset.id !== id) {
    preview.dataset.id = id;
    const clone = card.cloneNode(true);
    clone.style.removeProperty('visibility');
    clone.style.removeProperty('display');
    truncateAtFee(clone);
    preview.innerHTML = '';
    preview.appendChild(clone);
  }

  positionPreview(preview, clientX, clientY);
  preview.style.display = 'block';
}

function positionPreview(preview, x, y) {
  const pw = preview.offsetWidth || 320;
  const ph = preview.offsetHeight || 400;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Prefer right of cursor; flip left if it would overflow
  const left = (x + 24 + pw > vw) ? x - pw - 8 : x + 24;
  const top  = Math.min(Math.max(y - 20, 8), vh - ph - 8);
  preview.style.left = left + 'px';
  preview.style.top  = top + 'px';
}

// Remove the "Fee:" line and everything after it in the cloned card
function truncateAtFee(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.includes('Fee:')) {
      // Remove this node's element and all following siblings up the tree
      let el = node.parentElement;
      while (el && el !== root) {
        let sib = el.nextSibling;
        while (sib) {
          const next = sib.nextSibling;
          sib.parentNode.removeChild(sib);
          sib = next;
        }
        el.parentNode.removeChild(el);
        break;
      }
      return;
    }
  }
}

function hideItemPreview() {
  const preview = document.getElementById('poe-item-preview');
  if (preview) preview.style.display = 'none';
}

// ── Panel rendering ───────────────────────────────────────────────────────────

function buildPanel() {
  const panel = document.createElement('div');
  panel.id = 'poe-analyzer-panel';
  panel.innerHTML = `
    <div id="poe-analyzer-header">
      <span id="poe-analyzer-title" title="About Tradezilla">Tradezilla</span>
      <div id="poe-analyzer-controls">
        <button id="poe-table-toggle">⊞ Table</button>
        <button id="poe-clear-btn">Clear</button>
        <button id="poe-toggle-btn">−</button>
      </div>
    </div>
    <div id="poe-analyzer-body">
      <div id="poe-analyzer-summary">Waiting for items…</div>
      <div id="poe-analyzer-chart"></div>
    </div>
  `;
  document.body.appendChild(panel);

  panel.querySelector('#poe-analyzer-body').style.display = 'none';
  panel.querySelector('#poe-toggle-btn').textContent = '+';
  panel.querySelector('#poe-toggle-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAnalyzerPanel();
  });

  // Clicking the title shows the about modal; clicking elsewhere on the header toggles collapse
  panel.querySelector('#poe-analyzer-title').addEventListener('click', (e) => {
    e.stopPropagation();
    showAboutModal();
  });

  panel.querySelector('#poe-analyzer-header').addEventListener('click', (e) => {
    if (e.target.closest('#poe-analyzer-controls')) return;
    if (e.target.closest('#poe-analyzer-title')) return;
    toggleAnalyzerPanel();
  });

  panel.querySelector('#poe-table-toggle').addEventListener('click', toggleTableView);

  panel.querySelector('#poe-clear-btn').addEventListener('click', () => {
    affixMap.clear();
    itemMap.clear();
    listingOrder.length = 0;
    affixCursor.clear();
    tableSort = { key: null, dir: 'asc' };
    totalItems = 0;
    if (tableViewActive) toggleTableView();
    renderPanel();
  });

  makeDraggable(panel, panel.querySelector('#poe-analyzer-header'));

  return panel;
}

function getOrCreatePanel() {
  return document.getElementById('poe-analyzer-panel') || buildPanel();
}

function renderPanel() {
  const panel = getOrCreatePanel();
  panel.querySelector('#poe-analyzer-summary').textContent =
    `${totalItems} item${totalItems !== 1 ? 's' : ''} captured — ${affixMap.size} unique affixes`;
  renderChart();
}

function renderChart() {
  const panel = document.getElementById('poe-analyzer-panel');
  if (!panel) return;

  const chart = panel.querySelector('#poe-analyzer-chart');

  // Sort most common first
  const rows = [...affixMap.entries()].sort((a, b) => b[1].count - a[1].count);
  const maxCount = rows[0]?.[1].count || 1;

  chart.innerHTML = '';

  for (const [key, data] of rows) {
    const pct = totalItems > 0 ? (data.count / totalItems) * 100 : 0;
    const barWidth = (data.count / maxCount) * 100;
    const valueRange = data.values.length > 0
      ? `${Math.min(...data.values)}–${Math.max(...data.values)}`
      : null;
    const sample = [...data.rawSamples][0] || key;
    const hue = Math.round(240 - barWidth * 1.2);
    const barColor = `hsl(${hue}, 80%, 55%)`;

    const priceRange = formatPriceRange(data.prices);

    const row = document.createElement('div');
    row.className = 'poe-row';
    row.title = sample;
    row.innerHTML = `
      <div class="poe-label">
        ${escHtml(key)}
        ${valueRange ? `<span class="poe-range">${escHtml(valueRange)}</span>` : ''}
        ${priceRange ? `<span class="poe-price">${escHtml(priceRange)}</span>` : ''}
      </div>
      <div class="poe-bar-wrap">
        <div class="poe-bar" style="width:${barWidth.toFixed(1)}%;background:${barColor}"></div>
        <span class="poe-bar-label">${data.count} <span class="poe-pct">(${pct.toFixed(0)}%)</span></span>
      </div>`;

    row.addEventListener('click', () => scrollToItemWithAffix(key, data.listingIds));
    chart.appendChild(row);
  }
}

function scrollToItemWithAffix(key, listingIds) {
  if (!listingIds?.length) return;

  const uniqueIds = [...new Set(listingIds)];
  const start = (affixCursor.get(key) ?? 0) % uniqueIds.length;

  for (let i = 0; i < uniqueIds.length; i++) {
    const idx = (start + i) % uniqueIds.length;
    const id = uniqueIds[idx];
    const el = document.querySelector(`[data-id="${id}"]`)
      ?? findItemByIndex(listingOrder.indexOf(id));
    if (el) {
      // Store position past the found item so next click moves forward
      affixCursor.set(key, idx + 1);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashElement(el);
      return;
    }
  }
}

function findItemByIndex(idx) {
  if (idx < 0) return null;
  // PoE trade item rows — try common selectors
  const candidates = document.querySelectorAll(
    '.row[class*="item"], .resultset .row, section.row, div.row'
  );
  return candidates[idx] ?? null;
}

function flashElement(el) {
  el.classList.add('poe-analyzer-flash');
  setTimeout(() => el.classList.remove('poe-analyzer-flash'), 1600);
}

const CURRENCY_SHORT = {
  divine: 'div', chaos: 'c', exalted: 'ex', mirror: 'mir',
  'chaos-orb': 'c', 'divine-orb': 'div', alch: 'alch', fusing: 'fuse',
};

function formatPriceRange(prices) {
  if (!prices.length) return null;
  const byCurrency = {};
  for (const p of prices) {
    if (!byCurrency[p.currency]) byCurrency[p.currency] = [];
    byCurrency[p.currency].push(p.amount);
  }
  // Sort by frequency descending so most-common currency appears first
  return Object.entries(byCurrency)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([currency, amounts]) => {
      const lo = Math.min(...amounts);
      const hi = Math.max(...amounts);
      const label = CURRENCY_SHORT[currency] ?? currency;
      return lo === hi ? `${lo} ${label}` : `${lo}–${hi} ${label}`;
    })
    .join(' / ');
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Drag helper ───────────────────────────────────────────────────────────────

function makeDraggable(el, handle) {
  let ox = 0, oy = 0;
  handle.style.cursor = 'grab';
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    ox = e.clientX - el.getBoundingClientRect().left;
    oy = e.clientY - el.getBoundingClientRect().top;
    handle.style.cursor = 'grabbing';

    function onMove(e) {
      el.style.left = (e.clientX - ox) + 'px';
      el.style.top = (e.clientY - oy) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
    function onUp() {
      handle.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Styles ────────────────────────────────────────────────────────────────────

const style = document.createElement('style');
style.textContent = `
  #poe-analyzer-panel {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    width: 520px;
    max-height: 560px;
    background: #0d0d1a;
    border: 1px solid #ff6640;
    border-radius: 6px;
    font-family: "Fontin SmallCaps", "Segoe UI", system-ui, sans-serif;
    font-size: 12px;
    color: #c8c8c8;
    box-shadow: 0 4px 24px rgba(0,0,0,0.85);
    display: flex;
    flex-direction: column;
  }
  #poe-analyzer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #1a0a00;
    border-bottom: 1px solid #ff6640;
    border-radius: 6px 6px 0 0;
    user-select: none;
    flex-shrink: 0;
  }
  #poe-analyzer-title {
    color: #ff6640;
    font-weight: bold;
    font-size: 13px;
    letter-spacing: 0.05em;
    cursor: pointer;
  }
  #poe-analyzer-title:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  #poe-analyzer-controls {
    display: flex;
    gap: 6px;
  }
  #poe-clear-btn, #poe-toggle-btn, #poe-table-toggle {
    background: #1a1a2e;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  #poe-clear-btn:hover, #poe-toggle-btn:hover, #poe-table-toggle:hover {
    background: #2a2a3e;
    color: #fff;
  }
  #poe-analyzer-body {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  #poe-analyzer-summary {
    padding: 5px 12px;
    background: #12122a;
    color: #888;
    font-size: 11px;
    border-bottom: 1px solid #222;
    flex-shrink: 0;
  }
  #poe-analyzer-chart {
    overflow-y: auto;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .poe-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px 0;
    border-bottom: 1px solid #1a1a2a;
    cursor: pointer;
    border-radius: 3px;
  }
  .poe-row:last-child { border-bottom: none; }
  .poe-row:hover { background: #14142a; }
  @keyframes poe-flash {
    0%   { outline: 2px solid #ff6640; background: rgba(255,102,64,0.18); }
    60%  { outline: 2px solid #ff6640; background: rgba(255,102,64,0.10); }
    100% { outline: none; background: transparent; }
  }
  .poe-analyzer-flash {
    animation: poe-flash 1.6s ease-out forwards;
  }
  .poe-label {
    color: #9999dd;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .poe-range {
    color: #666;
    font-size: 10px;
    flex-shrink: 0;
  }
  .poe-price {
    margin-left: auto;
    color: #c8a84b;
    font-size: 10px;
    flex-shrink: 0;
  }
  .poe-bar-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 14px;
  }
  .poe-bar {
    height: 100%;
    border-radius: 2px;
    min-width: 2px;
    transition: width 0.3s ease;
    flex-shrink: 0;
  }
  .poe-bar-label {
    font-size: 11px;
    color: #ccc;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .poe-pct {
    color: #666;
    font-size: 10px;
  }

  /* ── Item table overlay ── */
  #poe-item-table-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 99998;
    background: #080810;
    padding-top: 60px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  #poe-item-table-wrap {
    overflow: auto;
    flex: 1;
    padding: 0 16px 16px;
  }
  #poe-item-table {
    border-collapse: collapse;
    font-size: 11px;
    color: #c8c8c8;
    white-space: nowrap;
    width: max-content;
    min-width: 100%;
  }
  .poe-tbl-th {
    background: #1a1a30;
    color: #ff6640;
    padding: 6px 10px;
    text-align: left;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 2px solid #ff6640;
    position: sticky;
    top: 0;
    z-index: 2;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    user-select: none;
  }
  .poe-tbl-th:hover { background: #22223a; }
  .poe-tbl-th.poe-tbl-sorted { background: #2a1a00; color: #ffaa40; }
  #poe-item-table tr {
    border-bottom: 1px solid #1a1a2a;
    cursor: pointer;
  }
  #poe-item-table tr:nth-child(even) { background: #0a0a18; }
  #poe-item-table tr:hover td { background: #1e1e38; }
  .poe-tbl-name {
    color: #c8a84b;
    font-weight: bold;
    padding: 5px 10px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .poe-tbl-base {
    color: #888;
    font-weight: normal;
    font-size: 10px;
  }
  .poe-tbl-price {
    color: #c8a84b;
    padding: 5px 10px;
    text-align: right;
  }
  .poe-tbl-ilvl {
    color: #aaa;
    padding: 5px 8px;
    text-align: center;
  }
  .poe-tbl-mod {
    padding: 5px 10px;
    color: #555;
    text-align: center;
  }
  .poe-tbl-mod.has {
    color: #8888ff;
  }

  #poe-table-footer {
    flex-shrink: 0;
    padding: 10px;
    text-align: center;
    color: #555;
    font-size: 11px;
    cursor: pointer;
    border-top: 1px solid #1a1a2a;
    letter-spacing: 0.05em;
    user-select: none;
  }
  #poe-table-footer:hover {
    color: #ff6640;
    background: #0f0f1e;
  }

  /* ── About modal ── */
  #poe-about-modal {
    position: fixed;
    inset: 0;
    z-index: 9999998;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.55);
  }
  #poe-about-box {
    background: #0d0d1a;
    border: 1px solid #ff6640;
    border-radius: 6px;
    padding: 20px 24px;
    max-width: 340px;
    width: 100%;
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 12px;
    color: #c8c8c8;
    box-shadow: 0 8px 40px rgba(0,0,0,0.9);
  }
  #poe-about-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  #poe-about-header strong {
    color: #ff6640;
    font-size: 15px;
    letter-spacing: 0.05em;
  }
  #poe-about-close {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 2px 4px;
  }
  #poe-about-close:hover { color: #fff; }
  #poe-about-box p {
    margin: 0 0 10px;
    line-height: 1.6;
    color: #aaa;
  }
  #poe-about-box p strong { color: #c8c8c8; }
  #poe-about-box p em { color: #ff6640; font-style: normal; }
  #poe-about-link {
    display: inline-block;
    margin-top: 4px;
    color: #7799ff;
    font-size: 11px;
    text-decoration: none;
  }
  #poe-about-link:hover { text-decoration: underline; }

  /* ── Item card hover preview ── */
  #poe-item-preview {
    display: none;
    position: fixed;
    z-index: 9999999;
    pointer-events: none;
    max-width: 420px;
    background: #0d0d1a;
    border: 1px solid #554422;
    border-radius: 4px;
    padding: 4px;
    box-shadow: 0 6px 32px rgba(0,0,0,0.9);
    /* Let the cloned card's own styles take over inside */
  }
  #poe-item-preview > * {
    /* Ensure the cloned card fills the preview */
    max-width: 100% !important;
    visibility: visible !important;
  }
`;
(document.head || document.documentElement).appendChild(style);

// ── Listen for data ───────────────────────────────────────────────────────────

window.addEventListener('message', (e) => {
  if (e.source === window && e.data?.__poe_analyzer) {
    if (e.data.result) {
      const panel = document.getElementById('poe-analyzer-panel');
      if (panel) panel.style.display = '';
      processItems(e.data.result);
    }
  }
});

// ── Detect trade site Clear button ────────────────────────────────────────────

document.addEventListener('click', (e) => {
  const el = e.target.closest('button, a, [role="button"]');
  if (!el) return;
  if (el.id === 'poe-clear-btn') return; // ignore our own clear
  if (el.textContent.trim().toLowerCase() === 'clear') {
    affixMap.clear();
    itemMap.clear();
    listingOrder.length = 0;
    affixCursor.clear();
    tableSort = { key: null, dir: 'asc' };
    totalItems = 0;
    if (tableViewActive) toggleTableView();
    const panel = document.getElementById('poe-analyzer-panel');
    if (panel) panel.style.display = 'none';
  }
}, true); // capture phase so we see it before Vue handles it

// ── Inject table button next to "Activate live search" ────────────────────────

function findLiveSearchBtn() {
  const all = document.querySelectorAll('button');
  console.log('[PoE] All buttons on page:', [...all].map(b => b.textContent.trim()));
  for (const btn of all) {
    if (btn.textContent.trim().toLowerCase().includes('activate live search')) return btn;
  }
  return null;
}

function injectTableButton() {
  if (document.getElementById('poe-inject-wrapper')) return; // already injected
  const liveBtn = findLiveSearchBtn();
  if (!liveBtn) {
    console.log('[PoE] Live search button not found yet');
    return;
  }

  console.log('[PoE] Found live search button:', liveBtn, 'parent:', liveBtn.parentElement);

  const btn = document.createElement('button');
  btn.id = 'poe-inject-table-btn';
  btn.type = 'button';
  btn.textContent = tableViewActive ? '⊟ Cards' : '⊞ Table';

  const cs = window.getComputedStyle(liveBtn);
  console.log('[PoE] Live btn computed — display:', cs.display, 'visibility:', cs.visibility, 'color:', cs.color, 'bg:', cs.backgroundColor, 'padding:', cs.padding);

  btn.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: 8px;
    padding: ${cs.padding};
    font: ${cs.font};
    color: ${cs.color};
    background: ${cs.background};
    border: ${cs.border};
    border-radius: ${cs.borderRadius};
    cursor: pointer;
    white-space: nowrap;
  `;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTableView();
  });

  const analyzerBtn = document.createElement('button');
  analyzerBtn.id = 'poe-inject-analyzer-btn';
  analyzerBtn.type = 'button';
  analyzerBtn.textContent = panelCollapsed ? '⊞ Analyzer' : '⊟ Analyzer';
  analyzerBtn.style.cssText = btn.style.cssText;
  analyzerBtn.style.marginLeft = '4px';
  analyzerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAnalyzerPanel();
  });

  const wrapper = document.createElement('span');
  wrapper.id = 'poe-inject-wrapper';
  wrapper.style.cssText = 'display:inline-flex;align-items:center;margin-left:8px;';
  btn.style.marginLeft = '0';
  wrapper.appendChild(btn);
  wrapper.appendChild(analyzerBtn);

  liveBtn.insertAdjacentElement('afterend', wrapper);

  console.log('[PoE] Injected buttons. Parent now:', liveBtn.parentElement?.innerHTML?.slice(0, 300));
}

// Re-sync injected button label when tableViewActive changes
function syncInjectedBtn() {
  const btn = document.getElementById('poe-inject-table-btn');
  if (btn) btn.textContent = tableViewActive ? '⊟ Cards' : '⊞ Table';
}

function toggleAnalyzerPanel() {
  const panel = document.getElementById('poe-analyzer-panel');
  if (!panel) return;
  if (panel.style.display === 'none') {
    panel.style.display = '';
    panelCollapsed = false;
  } else {
    panelCollapsed = !panelCollapsed;
  }
  panel.querySelector('#poe-analyzer-body').style.display = panelCollapsed ? 'none' : '';
  panel.querySelector('#poe-toggle-btn').textContent = panelCollapsed ? '+' : '−';
  syncInjectedAnalyzerBtn();
  if (!panelCollapsed) requestAnimationFrame(() => clampPanelToViewport(panel));
}

function showAboutModal() {
  const existing = document.getElementById('poe-about-modal');
  if (existing) { existing.remove(); return; }

  const modal = document.createElement('div');
  modal.id = 'poe-about-modal';
  modal.innerHTML = `
    <div id="poe-about-box">
      <div id="poe-about-header">
        <strong>Tradezilla</strong>
        <button id="poe-about-close">✕</button>
      </div>
      <p>Affix frequency analyzer for the Path of Exile trade site. Intercepts item data as it loads and surfaces affix distributions across all results.</p>
      <p>Built by <strong>Justin Harvey</strong> — <em>boschzilla</em></p>
      <a id="poe-about-link" href="https://github.com/boschzilla/tradezilla" target="_blank" rel="noopener">github.com/boschzilla/tradezilla</a>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector('#poe-about-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function clampPanelToViewport(panel) {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const rect = panel.getBoundingClientRect();
  if (rect.bottom > vh - 8) {
    panel.style.top = Math.max(8, vh - panel.offsetHeight - 8) + 'px';
    panel.style.bottom = 'auto';
  }
  if (rect.right > vw - 8) {
    panel.style.left = Math.max(8, vw - panel.offsetWidth - 8) + 'px';
    panel.style.right = 'auto';
  }
  if (rect.top < 8) {
    panel.style.top = '8px';
    panel.style.bottom = 'auto';
  }
}

function syncInjectedAnalyzerBtn() {
  const btn = document.getElementById('poe-inject-analyzer-btn');
  if (btn) btn.textContent = panelCollapsed ? '⊞ Analyzer' : '⊟ Analyzer';
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  getOrCreatePanel();
  initItemPreview();
  injectTableButton();

  // Watch for the live search button to appear (Vue SPA may render it late)
  const observer = new MutationObserver(() => injectTableButton());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
