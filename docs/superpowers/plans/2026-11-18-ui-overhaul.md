# PerthMap UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PerthMap frontend with a full-screen Positron map, flat-colour travel-time bands, and a floating control card (bottom sheet on mobile).

**Architecture:** Pure band/palette logic lives in `src/lib/bands.ts`. `TravelTimeMap` renders bands in a dedicated semi-transparent Leaflet pane, largest first, at full fill opacity. `ControlCard` (with `Legend` + restyled `Slider`) floats over the map; `App` owns the `minutes` state.

**Tech Stack:** React 19, Vite 6, react-leaflet 5, Leaflet 1.9, Tailwind 4, Radix Slider, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-18-ui-overhaul-design.md`

## Global Constraints

- Visual rewrite only: do not modify `src/assets/poly.json`, `data_gen/`, `.github/workflows/deploy.yml`, or the New Relic setup in `src/main.tsx`.
- Slider: min 10, max 85, step 5, default 45, controlled; aria-label "Maximum travel time in minutes".
- Visible bands: `time <= minutes`.
- Palette stops: `#0f766e` (time 10) → `#6d28d9` (midpoint) → `#ddd6fe` (time 85); linear sRGB interpolation; 16 colours.
- Basemap URL `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`, attribution `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>`.
- Map center `[-31.9514, 115.8617]`, zoom 12. CBD marker at `[-31.955612, 115.860234]`.
- Mobile breakpoint: `useIsMobile()` (< 768px).
- Font: `ui-sans-serif, system-ui, sans-serif`; no web-font dependency.
- Copy: wordmark "PerthMap"; subtitle "Public transport time to Perth CBD"; value label "Showing areas within"; footer "About" → `https://github.com/SrzStephen/PerthMap`, "Data: Transperth GTFS, © OpenStreetMap, © CARTO".
- Gates: `npm run lint`, `npm test`, `npm run build` all pass at the end of every task that touches code.

## Review Focus

1. **Slider at its extremes** — at 10 exactly one band shows with popup "Under 10 min"; at 85 all 16 show. (Tests in Task 1.)
2. **Feature `time` as a string or a non-Polygon geometry** — coerced with `Number()` / skipped, never throws. (Task 1.)
3. **Keyboard use of the slider** — ArrowRight moves 45 → 50 and the legend/value update. (Task 3.)
4. **Collapsed mobile sheet** — still shows the current value and an accessible expand button; zoom control sits above the sheet. (Task 3, Task 4 CSS.)
5. **Band paint order after slider changes** — bands rendered largest time first so the innermost band receives clicks, without the old remount-key hack. (Task 4.)

---

### Task 1: Band data & palette (`src/lib/bands.ts`)

**Files:**
- Create: `src/lib/bands.ts`
- Test: `src/lib/__tests__/bands.test.ts`

**Interfaces:**
- Produces:
  - `export const TIMES: number[]` — `[10, 15, …, 85]` (16 entries)
  - `export interface Band { time: number; positions: [number, number][][] }` — rings as `[lat, lng]`
  - `export function parseBands(fc: { features: Array<{ properties: { time: number | string }; geometry: { type: string; coordinates: unknown } }> }): Band[]` — skips non-`Polygon` geometries, swaps `[lng, lat]` → `[lat, lng]`, returns sorted by `time` **descending**
  - `export function visibleBands(bands: Band[], minutes: number): Band[]` — `time <= minutes`, order preserved
  - `export function bandColor(time: number): string` — lowercase `#rrggbb`
  - `export function bandLabel(time: number): string`

- [ ] **Step 1: Write failing tests** in `src/lib/__tests__/bands.test.ts`:
  - `TIMES` has length 16, first 10, last 85.
  - `parseBands` on features with times `[10, 85, 40]` returns times `[85, 40, 10]`; a ring `[[115.8, -31.9]]` becomes `[[-31.9, 115.8]]`.
  - `parseBands` with `time: "25"` yields `time === 25`; a feature with `geometry.type: "MultiPolygon"` is dropped (result length excludes it).
  - `visibleBands(bands, 10)` → only time 10; `visibleBands(bands, 85)` → all; `visibleBands(bands, 40)` → `[40, 10]` in that order.
  - `bandColor(10) === '#0f766e'`, `bandColor(85) === '#ddd6fe'`, `new Set(TIMES.map(bandColor)).size === 16`.
  - `bandLabel(10) === 'Under 10 min'`, `bandLabel(45) === '40–45 min'` (en dash).

- [ ] **Step 2: Run** `npx vitest run src/lib/__tests__/bands.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/bands.ts`.** Colour: `i = (time - 10) / 5`, `t = i / 15`; if `t <= 0.5` lerp `#0f766e`→`#6d28d9` by `t * 2`, else lerp `#6d28d9`→`#ddd6fe` by `(t - 0.5) * 2`; round each channel, format `#rrggbb`.

- [ ] **Step 4: Run** same command — Expected: PASS.

- [ ] **Step 5: Commit** `git add src/lib && git commit -m "feat: add band parsing and palette"`

---

### Task 2: Design tokens & slider restyle

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/ui/slider.tsx`
- Test: `src/components/ui/__tests__/slider.test.tsx` (must keep passing)

**Interfaces:**
- Produces: CSS custom properties on `:root` — `--surface` (`rgb(255 255 255 / 0.85)`), `--text` (`#0f172a`), `--muted` (`#64748b`), `--accent` (`#0f766e`), `--border` (`rgb(15 23 42 / 0.08)`); utility class `.glass` = surface bg + `backdrop-filter: blur(12px)` + border + `box-shadow: 0 8px 30px rgb(15 23 42 / 0.12)`; `html, body, #root` at `height: 100%; margin: 0`, body background `#f1f5f9`, font per Global Constraints.
- Leaflet restyle in `index.css`: `.leaflet-control-zoom` rounded-xl with `.glass` look and no default border; `.leaflet-control-attribution` 10px, muted, translucent background; `.leaflet-container` keeps `height: 100%; width: 100%` and `font-family: inherit`.

- [ ] **Step 1: Edit `slider.tsx` classes only** (no API change): track `h-2 bg-slate-200`, range `bg-[var(--accent)]`, thumb `h-5 w-5 border-2 border-[var(--accent)] bg-white shadow-md focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40`.
- [ ] **Step 2: Write the tokens and Leaflet overrides in `index.css`** as listed above. Keep `@import 'tailwindcss'`; drop the unused `dark` custom-variant.
- [ ] **Step 3: Run** `npm test && npm run lint` — Expected: PASS.
- [ ] **Step 4: Commit** `git commit -am "style: design tokens and slider restyle"`

---

### Task 3: Legend & ControlCard

**Files:**
- Create: `src/components/panel/Legend.tsx`, `src/components/panel/ControlCard.tsx`
- Test: `src/components/panel/__tests__/Legend.test.tsx`, `src/components/panel/__tests__/ControlCard.test.tsx`

**Interfaces:**
- Consumes: `TIMES`, `bandColor` (Task 1); `Slider` (Task 2); `useIsMobile` from `src/hooks/use-mobile.tsx`.
- Produces:
  - `export function Legend({ minutes }: { minutes: number }): JSX.Element` — 16 swatches, each `data-testid="legend-swatch"`, `data-time={time}`, `style.backgroundColor = bandColor(time)`, class `opacity-20` when `time > minutes`; tick labels 10, 30, 50, 70, 85.
  - `export function ControlCard({ minutes, onMinutesChange }: { minutes: number; onMinutesChange: (m: number) => void }): JSX.Element`

ControlCard layout: desktop = `absolute top-4 left-4 z-[1000] w-[300px] rounded-2xl glass p-5`; mobile = `absolute inset-x-4 bottom-4 z-[1000] rounded-2xl glass p-4`. Mobile has a header row with the value and a button (`aria-label` "Collapse controls"/"Expand controls", `aria-expanded`) toggling the body (expanded by default); collapsed shows only "PerthMap · {minutes} min" + button. Value displayed as `<span data-testid="minutes-value">{minutes}</span> min`.

- [ ] **Step 1: Write failing `Legend.test.tsx`:** `render(<Legend minutes={40} />)` → 16 `legend-swatch`; the 9 swatches with `data-time` 45…85 have class `opacity-20`; the 7 swatches 10…40 do not; first swatch background `rgb(15, 118, 110)`.
- [ ] **Step 2: Write failing `ControlCard.test.tsx`** (mock `../../../hooks/use-mobile` with a mutable `isMobile` flag):
  - shows "PerthMap", "Public transport time to Perth CBD", and `minutes-value` text `45`.
  - `getByRole('slider')` has aria-label "Maximum travel time in minutes"; focusing it and `user.keyboard('{ArrowRight}')` calls `onMinutesChange(50)`.
  - desktop: no "Collapse controls" button.
  - mobile: clicking "Collapse controls" hides the slider (`queryByRole('slider')` null), still shows `45` and an "Expand controls" button; clicking it restores the slider.
- [ ] **Step 3: Run** `npx vitest run src/components/panel` — Expected: FAIL (modules missing).
- [ ] **Step 4: Implement `Legend.tsx` and `ControlCard.tsx`.** Slider props: `value={[minutes]} min={10} max={85} step={5} onValueChange={([v]) => onMinutesChange(v)} aria-label=…` (pass aria-label to the Thumb if Radix requires it there — the test decides). Footer per Global Constraints copy, link `target="_blank" rel="noreferrer"`.
- [ ] **Step 5: Run** `npx vitest run src/components/panel` — Expected: PASS.
- [ ] **Step 6: Commit** `git add src/components/panel && git commit -m "feat: control card and legend"`

---

### Task 4: TravelTimeMap & CBD marker

**Files:**
- Create: `src/components/map/TravelTimeMap.tsx`, `src/components/map/CbdMarker.tsx`
- Modify: `src/index.css` (marker + mobile zoom offset styles)
- Test: `src/components/map/__tests__/TravelTimeMap.test.tsx`

**Interfaces:**
- Consumes: `parseBands`, `visibleBands`, `bandColor`, `bandLabel`, `Band` (Task 1).
- Produces:
  - `export function TravelTimeMap({ minutes }: { minutes: number }): JSX.Element`
  - `export function CbdMarker(): JSX.Element`

Implementation decisions:
- `const BANDS = parseBands(poly)` at module scope (import `../../assets/poly.json`).
- `<MapContainer center zoom={12} zoomControl={false} className="h-full w-full">`, `<TileLayer>` per Global Constraints, `<ZoomControl position="bottomright" />`.
- `<Pane name="bands" style={{ zIndex: 350, opacity: 0.55 }}>` containing one `<Polygon key={band.time} positions={band.positions} pathOptions={{ stroke: false, fillColor: bandColor(band.time), fillOpacity: 1 }}><Popup>{bandLabel(band.time)}</Popup></Polygon>` per `visibleBands(BANDS, minutes)` (already largest first).
- `CbdMarker`: `L.divIcon({ className: 'cbd-marker', html: <inline SVG pin 28×36, fill var(--accent), white 2px ring> + '<span class="cbd-label">Perth CBD</span>', iconSize: [28, 36], iconAnchor: [14, 36] })`, memoised at module scope. CSS: `.cbd-marker { background: none; border: none }`, `.cbd-label` small white pill with shadow positioned right of the pin.
- `index.css`: `@media (max-width: 767px) { .leaflet-bottom.leaflet-right { bottom: 220px } }` so zoom/attribution sit above the sheet.

- [ ] **Step 1: Write failing test** mocking `react-leaflet` (`MapContainer`, `TileLayer`, `ZoomControl`, `Pane`, `Polygon`, `Popup`, `Marker` as simple divs; `Polygon` mock records `pathOptions` via `data-fill` and `data-testid="polygon"`) and `../../../assets/poly.json` with three Polygon features, times 10, 45, 85 (coordinates `[[[115.8,-31.9],[115.9,-31.9],[115.9,-32.0],[115.8,-31.9]]]`):
  - `minutes={45}` → 2 polygons, DOM order popups `['40–45 min', 'Under 10 min']`.
  - `minutes={85}` → 3 polygons; `minutes={10}` → 1 polygon with popup "Under 10 min".
  - rerender from 85 → 45 → 85 keeps largest-first order `['80–85 min', '40–45 min', 'Under 10 min']`.
  - first polygon at `minutes={85}` has `data-fill` `#ddd6fe`.
  - a marker is rendered.
- [ ] **Step 2: Run** `npx vitest run src/components/map` — Expected: FAIL.
- [ ] **Step 3: Implement** `TravelTimeMap.tsx`, `CbdMarker.tsx`, CSS additions.
- [ ] **Step 4: Run** `npx vitest run src/components/map` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/components/map src/index.css && git commit -m "feat: travel time map with flat bands and CBD marker"`

---

### Task 5: Wire App, remove old UI, verify

**Files:**
- Modify: `src/App.tsx`, `index.html`, `package.json`, `package-lock.json`, `README.md` (screenshot only)
- Delete: `src/components/Map/` (incl. `__tests__/Map.test.tsx`), `public/img/`
- Create: `doc/img.png` (replaced screenshot), `doc/img-mobile.png`

**Interfaces:**
- Consumes: `TravelTimeMap` (Task 4), `ControlCard` (Task 3).

- [ ] **Step 1: Rewrite `App.tsx`:** `const [minutes, setMinutes] = useState(45)`; render `<main className="relative h-[100dvh] w-screen overflow-hidden"><TravelTimeMap minutes={minutes} /><ControlCard minutes={minutes} onMinutesChange={setMinutes} /></main>`; import `leaflet/dist/leaflet.css`.
- [ ] **Step 2: Delete** `src/components/Map/` and `public/img/`; `grep -r "img/\|components/Map" src` returns nothing.
- [ ] **Step 3: Remove deps:** `npm uninstall install react-icons @types/react-leaflet`.
- [ ] **Step 4: `index.html`:** title "PerthMap — commute time to Perth CBD", add `<meta name="description" content="How long it takes to reach Perth CBD by public transport, mapped.">` and `<meta name="theme-color" content="#0f766e">`; fix favicon `type` to `image/x-icon`.
- [ ] **Step 5: Run gates:** `npm run lint && npm test && npm run build` — Expected: all pass, no TS errors.
- [ ] **Step 6: Visual check:** `npm run dev`, capture 1366×900 and 390×844 screenshots (Playwright/Chromium if available, else ask the user). Check: bands are flat distinct colours, legend matches map, card readable, mobile sheet doesn't cover zoom. Save to `doc/img.png` / `doc/img-mobile.png`; remove the broken `![](img_2.png)` line from `README.md`.
- [ ] **Step 7: Commit** `git add -A && git commit -m "feat: wire new UI, remove old map and unused deps"`
