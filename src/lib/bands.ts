export const TIMES: number[] = Array.from({length: 16}, (_, i) => 10 + i * 5)

export interface Band {
    time: number
    /** Polygon rings as [lat, lng] pairs. */
    positions: [number, number][][]
}

interface FeatureLike {
    properties: { time: number | string }
    geometry: { type: string; coordinates: unknown }
}

/** Polygon features → bands sorted largest time first (so smaller bands paint on top). */
export function parseBands(fc: { features: FeatureLike[] }): Band[] {
    return fc.features
        .filter(f => f.geometry?.type === 'Polygon')
        .map(f => ({
            time: Number(f.properties.time),
            positions: (f.geometry.coordinates as number[][][]).map(ring =>
                ring.map(([lng, lat]) => [lat, lng] as [number, number])),
        }))
        .sort((a, b) => b.time - a.time)
}

export function visibleBands(bands: Band[], minutes: number): Band[] {
    return bands.filter(b => b.time <= minutes)
}

const STOPS = ['#0f766e', '#6d28d9', '#ddd6fe'].map(hex =>
    [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)))

function lerp(a: number[], b: number[], t: number): string {
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

/** Teal (fast) → violet → pale violet (slow). */
export function bandColor(time: number): string {
    const t = Math.min(Math.max((time - 10) / 75, 0), 1)
    return t <= 0.5 ? lerp(STOPS[0], STOPS[1], t * 2) : lerp(STOPS[1], STOPS[2], (t - 0.5) * 2)
}

export function bandLabel(time: number): string {
    return time <= 10 ? 'Under 10 min' : `${time - 5}–${time} min`
}
