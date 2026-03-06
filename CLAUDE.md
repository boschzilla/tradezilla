# Tradezilla — Claude Context

## Project overview

Browser extension (Manifest V3) for pathofexile.com/trade. Intercepts the PoE trade API fetch calls, aggregates affix data, and renders a floating analyzer panel + full-screen item table overlay.

## File map

- `manifest.json` — MV3 manifest. Permissions: `activeTab`, `scripting`. Host: `*://www.pathofexile.com/*`
- `interceptor.js` — Content script (world: MAIN, run_at: document_start). Injects `injected.js` as a script tag into the page so it runs in page context.
- `injected.js` — Runs in page context. Monkey-patches `window.fetch` to intercept `/api/trade/fetch/` and `/api/trade2/fetch/` responses and postMessage the result data to the content script.
- `content.js` — Main content script. All UI, state, and logic lives here.
- `popup.html` — Toolbar popup. Static info only.
- `icon.png` — Extension icon (used at 16/48/128px).

## content.js architecture

### State (module-level)
- `affixMap` — Map of normalized affix key → `{ count, rawSamples, values, listingIds, prices }`
- `itemMap` — Map of listingId → `{ name, baseType, ilvl, price, mods }`
- `listingOrder` — insertion-order array of listing IDs
- `affixCursor` — Map tracking next item index to highlight per affix key
- `totalItems`, `tableViewActive`, `tableSort`, `panelCollapsed`

### Key functions
- `processItems(results)` — ingests API response array, updates maps, calls `renderPanel()` and `updateItemTable()` if table is active
- `toggleTableView()` — shows/hides the full-screen table overlay; hides/restores the PoE results container via `visibility:hidden`
- `toggleAnalyzerPanel()` — expands/collapses the floating panel; calls `clampPanelToViewport()` on expand
- `renderChart()` — builds the affix frequency bar chart inside the panel
- `renderItemTable()` / `appendItemRow()` — builds the sortable table
- `injectTableButton()` — injects Table + Analyzer buttons next to "Activate live search" on the trade page; uses a MutationObserver to handle Vue SPA re-renders
- `showAboutModal()` — toggles the about modal (click Tradezilla title)
- `makeDraggable(el, handle)` — drag handler for the panel

### UI elements injected into the page
- `#poe-analyzer-panel` — floating fixed panel (bottom-right by default, draggable)
- `#poe-item-table-overlay` — full-screen table overlay
- `#poe-item-preview` — hover card preview (pointer-events: none)
- `#poe-about-modal` — about modal
- `#poe-inject-wrapper` — span containing the injected Table + Analyzer buttons

## Conventions
- All injected element IDs are prefixed `poe-`
- CSS is injected as a single `<style>` tag appended to `document.head`
- The PoE trade site is a Vue SPA — DOM mutations from Vue can remove injected elements; the MutationObserver in `init()` re-injects the buttons when needed
- `escHtml()` is used for all user-visible string interpolation into innerHTML
- Affix normalization: all numbers replaced with `#`, trimmed

## Author
Justin Harvey — boschzilla
https://github.com/boschzilla/tradezilla
