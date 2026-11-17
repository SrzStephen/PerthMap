# PerthMap UI Overhaul — Design

Date: 2026-11-18
Status: Approved (conversation), pending spec review

## Goal

Rewrite the PerthMap frontend so it looks good and reads clearly. Same single feature —
public-transport travel time to Perth CBD, filtered by a minutes slider — with a modern,
full-screen, mobile-friendly presentation.

### What the user said
- "I hate the UI for this, do a full rewrite and make it look better."
- Scope: **visual rewrite only** (no new features, no data/pipeline changes).
- Layout: **full-screen map with a floating control card** (bottom sheet on mobile).
- Theme: **light, muted basemap** (CARTO Positron), light UI card.

### Problems being fixed
1. Translucent nested polygons stack into an unreadable purple mush.
2. Default OSM tiles are visually busy and clash with the overlay.
3. No legend — colour has no stated meaning.
4. Side panel is mostly empty; header is a plain grey bar.
5. Map is fixed at 500px tall (bug); not usable on mobile.

### Non-goals
- Search, hover readouts, URL state, multiple destinations.
- Changes to `src/assets/poly.json`, `data_gen/`, or `.github/workflows/deploy.yml`.

## Stack

Unchanged: React 19, Vite 6, react-leaflet 5 / Leaflet, Tailwind 4, Radix slider
(`src/components/ui/slider.tsx`), Vitest + Testing Library. Remove unused dependencies
`install`, `react-icons`, `@types/react-leaflet`.

## Layout

- Map fills the viewport (`100dvh`, `100vw`); no page header, no page scroll.
- **Desktop (≥ 768px, matches `useIsMobile`):** floating card, top-left, 16px inset, width ~300px.
  White at ~85% opacity with `backdrop-blur`, `rounded-2xl`, soft shadow, 1px subtle border.
- **Mobile (< 768px):** the same card content docks to the bottom as a sheet spanning
  the width (16px side gutters, rounded top corners). A toggle collapses it to a slim bar
  showing only the current value ("45 min") and an expand chevron. Expanded by default.
- Leaflet zoom control moves to bottom-right (on mobile, positioned above the sheet).
  The LayersControl is removed; basemap and overlay are always on.
- Attribution stays in Leaflet's attribution control (bottom-right), restyled small/muted.

## Control card contents (top to bottom)

1. Wordmark: **PerthMap** (semibold, tracking-tight).
2. Subtitle: "Public transport time to Perth CBD" (muted, small).
3. Current value, large: **45** `min` — label reads "Showing areas within".
4. Slider: min 10, max 85, step 5, default 45. Controlled (`value`, not `defaultValue`).
   Accessible label "Maximum travel time in minutes".
5. Legend: a row of 16 swatches (one per band, 10…85) with tick labels at 10, 30, 50, 70, 85
   (and the endpoints). Swatches for bands **above** the slider value render at ~20%
   opacity, so legend and slider read as one control.
6. Footer (tiny, muted): "About" link to the GitHub repo · "Data: Transperth GTFS, © OpenStreetMap, © CARTO".

## Map & overlay

- Basemap: CARTO Positron
  `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`, attribution
  `© OpenStreetMap contributors © CARTO`. Initial view: center `[-31.9514, 115.8617]`, zoom 12.
- Overlay drawn in a custom Leaflet pane `bands` (z-index between tiles and markers) with
  CSS `opacity: 0.55` on the pane.
- Polygons are nested (each larger band contains the smaller ones). Render visible bands
  **sorted largest time first**, each with `fillOpacity: 1`, `stroke: false`. Smaller bands
  paint over larger ones, so every area shows exactly one flat colour; the pane opacity
  provides uniform translucency. This replaces the per-polygon alpha that caused the mush.
- Visible bands: `time <= minutes` (slider value inclusive).
- Remove the `key={index_filterVal}` remount hack; ordering is now deterministic.
- Clicking a band opens a popup "`{time-5}–{time} min`" (for the 10-min band: "Under 10 min").
  Because smaller bands sit on top, the click hits the innermost band at that point.
- Colour palette defined in the frontend (ignore `r/g/b` in the GeoJSON): 16 steps,
  linear sRGB interpolation through three stops:
  `#0f766e` (teal-700, fastest) → `#6d28d9` (violet-700, mid) → `#ddd6fe` (violet-200, slowest).
  Close = strong, far = pale; all steps legible on Positron.
- CBD marker: custom `L.divIcon` with an inline SVG pin (teal fill, white ring) and a small
  "Perth CBD" label chip, at `[-31.955612, 115.860234]`. Remove `L.Icon.Default.imagePath`
  and the default marker PNGs from `public/img/` (and `layers*.png`).

## Code structure

| File | Responsibility |
|---|---|
| `src/App.tsx` | Owns `minutes` state; renders `TravelTimeMap` + `ControlCard`. |
| `src/lib/bands.ts` | Pure: parse features into `Band {time, rings}` sorted desc; `bandColor(time)`; `bandLabel(time)`; `TIMES` constant; `visibleBands(bands, minutes)`. |
| `src/components/map/TravelTimeMap.tsx` | MapContainer, Positron tiles, `bands` pane, polygons, CBD marker, zoom position. |
| `src/components/map/CbdMarker.tsx` | divIcon marker. |
| `src/components/panel/ControlCard.tsx` | Card shell; desktop floating vs mobile bottom sheet (uses `useIsMobile`), collapse state. |
| `src/components/panel/Legend.tsx` | Swatch row + ticks, fades bands above `minutes`. |
| `src/components/ui/slider.tsx` | Existing Radix slider, restyled (teal range, larger thumb). |
| `src/index.css` | Design tokens on `:root` (surface, text, muted, accent), Leaflet control restyling, font. |

Old `src/components/Map/` directory is deleted. Font: system UI stack (`ui-sans-serif, system-ui, sans-serif`); no web-font dependency.

## Error handling

Data is a bundled static import, so there is no runtime fetch to fail. Tile load errors are
handled by Leaflet (blank tiles). Features with unexpected geometry types are skipped by
`bands.ts` rather than throwing.

## Testing

- `bands.test.ts`: sorting desc, `visibleBands` inclusive threshold, `bandColor` returns 16
  distinct colours with endpoints matching the palette, `bandLabel` incl. the "Under 10 min" case,
  non-Polygon features skipped.
- `Legend.test.tsx`: renders 16 swatches; swatches above `minutes` have the faded class.
- `ControlCard.test.tsx`: shows current value; slider change calls back; mobile collapse toggle
  hides/shows body.
- Update/replace existing `Map.test.tsx`, keep `slider.test.tsx` and `use-mobile.test.tsx` passing.
- Gates: `npm run lint`, `npm test`, `npm run build` all pass.
- Visual check: screenshots at 1366×900 and 390×844 via the dev server.
