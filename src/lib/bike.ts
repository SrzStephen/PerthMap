/** Bike ride times and paths. Format: data_gen/README.md (`bike.grid.bin`, `bike.routes.json`). */
import {NO_STOP, UNREACHABLE, cellAt, dataUrl, fetchJson, gunzip, type DataIndex, type Grid, type GridMeta} from './grid'
import {decodePolyline} from './polyline'
import {nearestReachable} from './route'

export interface BikeGrid {
    meta: GridMeta
    /** Ride seconds at the data's reference speed; 0xFFFF = unreachable. */
    seconds: Uint16Array
    /** Index into `BikeRoutes.paths` (the cell's block path); 0xFFFF = none. */
    path: Uint16Array
}

/** [seconds, metres, ascent, descent, segment ids]; ascent/descent null without elevation data. */
export type BikePath = [number, number, number | null, number | null, number[]]

export interface BikeRoutes {
    refSpeedKmh: number
    /** Per segment: encoded polyline (precision 5), length in metres, heights [h0, Δ…] every 50 m or null. */
    shapes: string[]
    lengths: number[]
    elev: (number[] | null)[]
    paths: BikePath[]
}

export type RideResult =
    | { kind: 'outside' }
    | { kind: 'unreachable' }
    | { kind: 'missing'; minutes: number; metres: number; speed: number }
    | {
    kind: 'ride'; minutes: number; metres: number; speed: number; geometry: [number, number][]
    profile: [number, number][] | null; ascent: number | null; descent: number | null
}

const NA = 0xffff
const MAGIC = 'PMB1'
const VERSION = 1
const HEADER = 14
const ELEV_STEP_M = 50

export async function decodeBike(gz: ArrayBuffer, meta: GridMeta): Promise<BikeGrid> {
    const buf = await gunzip(gz)
    const view = new DataView(buf)
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4))
    if (magic !== MAGIC || view.getUint16(4, true) !== VERSION) throw new Error('bike format')
    const width = view.getUint32(6, true), height = view.getUint32(10, true)
    if (width !== meta.width || height !== meta.height) throw new Error('bike size')
    const n = width * height
    return {
        meta,
        seconds: new Uint16Array(buf.slice(HEADER, HEADER + 2 * n)),
        path: new Uint16Array(buf.slice(HEADER + 2 * n, HEADER + 4 * n)),
    }
}

let bikeGrid: Promise<BikeGrid> | null = null

/** Cached; a failed load is evicted so it can be retried. */
export function loadBike(index: DataIndex): Promise<BikeGrid> {
    if (!bikeGrid) {
        const p = fetch(dataUrl('bike.grid.bin'))
            .then(r => {
                if (!r.ok) throw new Error(`bike.grid.bin: HTTP ${r.status}`)
                return r.arrayBuffer()
            })
            .then(buf => decodeBike(buf, index.grid))
        p.catch(() => {
            if (bikeGrid === p) bikeGrid = null
        })
        bikeGrid = p
    }
    return bikeGrid
}

export const evictBike = () => void (bikeGrid = null)

/** The bike grid as a `Grid` of minutes at `speedKmh`, so contours and lookups work as for transit. */
export function bikeMinutes(bike: BikeGrid, speedKmh: number, refSpeedKmh: number): Grid {
    const n = bike.seconds.length
    const minutes = new Uint8Array(n)
    const scale = refSpeedKmh / speedKmh / 60
    for (let i = 0; i < n; i++) {
        const s = bike.seconds[i]
        minutes[i] = s === NA ? UNREACHABLE : Math.min(254, Math.round(s * scale))
    }
    return {
        meta: bike.meta, median: minutes, fastest: minutes,
        sample: new Uint8Array(n).fill(UNREACHABLE), walk: new Uint8Array(n).fill(UNREACHABLE),
        stop: new Uint16Array(n).fill(NO_STOP),
    }
}

let bikeRoutes: Promise<BikeRoutes> | null = null

export function loadBikeRoutes(): Promise<BikeRoutes> {
    if (!bikeRoutes) {
        const p = fetchJson<BikeRoutes>('bike.routes.json')
        p.catch(() => {
            if (bikeRoutes === p) bikeRoutes = null
        })
        bikeRoutes = p
    }
    return bikeRoutes
}

/** (distance m, height m) along the path; null if any segment lacks elevation data. */
export function profile(path: BikePath, routes: BikeRoutes): [number, number][] | null {
    const out: [number, number][] = []
    let offset = 0
    for (const [j, s] of path[4].entries()) {
        const elev = routes.elev[s]
        if (!elev) return null
        const len = routes.lengths[s]
        let h = 0
        elev.forEach((d, k) => {
            h = k === 0 ? d : h + d
            if (j > 0 && k === 0) return // the joint is the previous segment's last point
            out.push([offset + Math.min(k * ELEV_STEP_M, len), h])
        })
        offset += len
    }
    return out
}

const decoded = new WeakMap<BikeRoutes, Map<number, [number, number][]>>()

/** [lat, lng] points of the whole path. */
export function pathGeometry(path: BikePath, routes: BikeRoutes): [number, number][] {
    let cache = decoded.get(routes)
    if (!cache) decoded.set(routes, cache = new Map())
    const out: [number, number][] = []
    for (const s of path[4]) {
        let pts = cache.get(s)
        if (!pts) cache.set(s, pts = decodePolyline(routes.shapes[s], 5))
        out.push(...(out.length ? pts.slice(1) : pts))
    }
    return out
}

/** The ride for a clicked point: time and distance from the (snapped) cell itself, path and profile from its block. */
export function bikeRideAt(minutes: Grid, bike: BikeGrid, routes: BikeRoutes | null, lat: number, lng: number,
                           speedKmh: number, refSpeedKmh: number): RideResult {
    const clicked = cellAt(bike.meta, lat, lng)
    if (clicked === null) return {kind: 'outside'}
    const i = nearestReachable(minutes, clicked)
    if (i === null) return {kind: 'unreachable'}
    const ride = {minutes: minutes.fastest[i], metres: Math.round(bike.seconds[i] * refSpeedKmh / 3.6), speed: speedKmh}
    const p = bike.path[i]
    const path = p === NA ? undefined : routes?.paths[p]
    if (!routes || !path) return {kind: 'missing', ...ride}
    return {kind: 'ride', ...ride, geometry: pathGeometry(path, routes), profile: profile(path, routes), ascent: path[2], descent: path[3]}
}
