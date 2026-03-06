# Tradezilla

A Brave/Chrome extension for the [Path of Exile trade site](https://www.pathofexile.com/trade) that intercepts item data as it loads and surfaces affix frequency distributions across all results.

Built by **Justin Harvey** — *boschzilla*

---

## Features

- **Affix frequency chart** — shows every affix found across loaded items, sorted by occurrence, with value ranges and price distribution
- **Sortable item table** — full-screen overlay with one row per item and one column per top affix; click any column header to sort
- **Card hover preview** — hover an item row in the table to see its original trade card
- **Click a row** to jump back to the card layout and highlight that item
- **Injected buttons** — Table and Analyzer toggle buttons inserted directly next to the "Activate live search" button on the trade page
- **Draggable panel** — drag the Tradezilla analyzer panel anywhere on screen
- **About modal** — click the Tradezilla title to see info and links

---

## Installation

1. Clone or download this repo
2. Open Brave (or Chrome) and go to `brave://extensions` / `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the repo folder
5. Navigate to [pathofexile.com/trade](https://www.pathofexile.com/trade), run a search, and the extension activates automatically

---

## Usage

- Run any search on the PoE trade site — items are captured as they load
- Click **Table** (next to "Activate live search" or in the panel) to switch to the sortable table view
- Click **Analyzer** or the panel title bar to expand the affix frequency chart
- Click any affix row in the chart to scroll to an item with that affix (cycles through matches)
- Click any item row in the table to return to card view and highlight that item
- Click the footer bar below the table to return to card view
- Click **Clear** to reset all captured data

---

## Project Structure

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (MV3) |
| `content.js` | Main logic — UI, affix analysis, table, panel |
| `injected.js` | Injected into page context to intercept `fetch` calls |
| `interceptor.js` | Content script that injects `injected.js` into the page |
| `popup.html` | Extension toolbar popup |
| `icon.png` | Extension icon |

---

## License

MIT
