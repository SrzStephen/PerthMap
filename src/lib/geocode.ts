/** Address search via OpenStreetMap Nominatim, limited to the mapped area. Search on submit only: Nominatim's usage
 * policy forbids autocomplete. */

export interface Place {
    label: string
    lat: number
    lng: number
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
// GRID_BBOX (data_gen/pipeline.py) as west,north,east,south
const VIEWBOX = '115.679169,-31.725200,116.060099,-32.301063'

/** Nominatim's display name without what follows the postcode (", Australia"). */
export function placeLabel(name: string): string {
    const parts = name.split(', ')
    const pc = parts.findIndex(p => /^\d{4}$/.test(p))
    return (pc >= 0 ? parts.slice(0, pc + 1) : parts).join(', ')
}

export async function geocode(q: string, opts: { signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<Place[]> {
    const params = new URLSearchParams({
        format: 'jsonv2', q, countrycodes: 'au', viewbox: VIEWBOX, bounded: '1', limit: '5',
    })
    const r = await (opts.fetch ?? fetch)(`${NOMINATIM}?${params}`, {signal: opts.signal})
    if (!r.ok) throw new Error(`Nominatim: HTTP ${r.status}`)
    const rows = await r.json() as { display_name: string; lat: string; lon: string }[]
    return rows.map(row => ({label: placeLabel(row.display_name), lat: Number(row.lat), lng: Number(row.lon)}))
}
