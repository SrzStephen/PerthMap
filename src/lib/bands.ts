/** Band times the palette is scaled over (10–85 in 5-min steps). */
export const TIMES: number[] = Array.from({length: 16}, (_, i) => 10 + i * 5)

export interface Band {
    time: number
    /** Polygons (outer ring then holes), each ring as [lat, lng] pairs. */
    positions: [number, number][][][]
}

interface FeatureLike {
    properties: { time: number | string }
    geometry: { type: string; coordinates: unknown }
}

const toLatLng = (polygon: number[][][]) =>
    polygon.map(ring => ring.map(([lng, lat]) => [lat, lng] as [number, number]))

/** (Multi)Polygon features → bands sorted largest time first (so smaller bands paint on top). */
export function parseBands(fc: { features: FeatureLike[] }): Band[] {
    return fc.features
        .filter(f => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')
        .map(f => {
            const polygons = f.geometry.type === 'Polygon'
                ? [f.geometry.coordinates as number[][][]]
                : f.geometry.coordinates as number[][][][]
            return {time: Number(f.properties.time), positions: polygons.map(toLatLng)}
        })
        .sort((a, b) => b.time - a.time)
}

// Lightness rises monotonically so neighbouring bands stay distinguishable through the pane's alpha.
const STOPS = ['#115e59', '#0d9488', '#a5b4fc', '#ede9fe'].map(hex =>
    [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)))

function lerp(a: number[], b: number[], t: number): string {
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

/** Deep teal (fast) → teal → periwinkle → pale violet (slow). */
export function bandColor(time: number): string {
    const t = Math.min(Math.max((time - 10) / 75, 0), 1) * (STOPS.length - 1)
    const i = Math.min(Math.floor(t), STOPS.length - 2)
    return lerp(STOPS[i], STOPS[i + 1], t - i)
}

/** `innermost` is the smallest band time in the data; that band covers everything under it. */
export function bandLabel(time: number, innermost: number): string {
    return time <= innermost ? `Under ${time} min` : `${time - 5}–${time} min`
}

/** Legend tick labels: both ends plus every 20 minutes (…30, 50, 70…) not crowding an end. */
export function legendTicks(times: number[]): number[] {
    const first = times[0], last = times[times.length - 1]
    return times.filter(t => t === first || t === last || (t % 20 === 10 && t - first >= 10 && last - t >= 10))
}
