/** Travel-time grids produced by data_gen (`public/data/`). See data_gen/README.md for the format. */

export type DayKey = 'weekday' | 'saturday' | 'sunday'

export interface GridMeta {
    width: number
    height: number
    minLon: number
    minLat: number
    spacing: number
}

export interface DataIndex {
    version: number
    generated: string
    grid: GridMeta
    days: { key: DayKey; label: string; date: string }[]
    hours: number[]
}

export interface Grid {
    meta: GridMeta
    /** Median minutes over the window (map colour). */
    median: Uint8Array
    /** Fastest minutes in the window (route panel). */
    fastest: Uint8Array
    /** Index of the fastest arrival sample. */
    sample: Uint8Array
    /** Minutes walked to the boarding stop (or in total for a direct walk). */
    walk: Uint8Array
    /** Global stop index of the boarding stop. */
    stop: Uint16Array
}

export const UNREACHABLE = 255
export const NO_STOP = 0xffff
export const DIRECT_WALK = 0xfffe

const MAGIC = 'PMG1'
const VERSION = 1
const HEADER = 14

export const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`

export const windowKey = (day: DayKey, hour: number) => `${day}-${String(hour).padStart(2, '0')}`

/** Gunzips unless the host already did (it may serve the file with Content-Encoding: gzip). */
async function gunzip(body: ArrayBuffer): Promise<ArrayBuffer> {
    const head = new Uint8Array(body, 0, Math.min(2, body.byteLength))
    if (head[0] !== 0x1f || head[1] !== 0x8b) return body
    const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).arrayBuffer()
}

export async function decodeGrid(gz: ArrayBuffer, meta: GridMeta): Promise<Grid> {
    const buf = await gunzip(gz)
    const view = new DataView(buf)
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4))
    if (magic !== MAGIC || view.getUint16(4, true) !== VERSION) throw new Error('grid format')
    const width = view.getUint32(6, true), height = view.getUint32(10, true)
    if (width !== meta.width || height !== meta.height) throw new Error('grid size')
    const n = width * height
    const plane = (i: number) => new Uint8Array(buf, HEADER + i * n, n)
    const stopBytes = buf.slice(HEADER + 4 * n, HEADER + 6 * n)
    return {meta, median: plane(0), fastest: plane(1), sample: plane(2), walk: plane(3), stop: new Uint16Array(stopBytes)}
}

/** Flat cell index for a point, or null outside the grid. Row 0 is the south edge. */
export function cellAt(meta: GridMeta, lat: number, lng: number): number | null {
    const ix = Math.round((lng - meta.minLon) / meta.spacing)
    const iy = Math.round((lat - meta.minLat) / meta.spacing)
    if (ix < 0 || iy < 0 || ix >= meta.width || iy >= meta.height) return null
    return iy * meta.width + ix
}

async function fetchOk(file: string): Promise<Response> {
    const r = await fetch(dataUrl(file))
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`)
    return r
}

export async function fetchJson<T>(file: string): Promise<T> {
    return (await fetchOk(file)).json() as Promise<T>
}

export const loadIndex = () => fetchJson<DataIndex>('index.json')

const grids = new Map<string, Promise<Grid>>()

/** Cached per window key; a failed load is evicted so it can be retried. */
export function loadGrid(index: DataIndex, key: string): Promise<Grid> {
    let p = grids.get(key)
    if (!p) {
        p = fetchOk(`${key}.grid.bin`)
            .then(r => r.arrayBuffer())
            .then(buf => decodeGrid(buf, index.grid))
        p.catch(() => grids.delete(key))
        grids.set(key, p)
    }
    return p
}

export const evictGrid = (key: string) => void grids.delete(key)
