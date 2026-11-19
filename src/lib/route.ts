/** Fastest route for a clicked point. Format: data_gen/README.md (`routes.json`, `stops.json`). */
import {DIRECT_WALK, NO_STOP, UNREACHABLE, cellAt, fetchJson, type Grid} from './grid'
import {decodePolyline} from './polyline'

/** [line, from stop, to stop, depart, arrive, shape, i0, i1]; stops -1 = not a GTFS stop; times in minutes. */
export type Leg = [number, number, number, number, number, number, number, number]
/** [depart, arrive, legs] in Perth minutes since midnight. */
export type Trip = [number, number, Leg[]]

export interface Routes {
    samples: string[]
    /** [mode, line, headsign] */
    lines: [string, string, string][]
    /** Encoded polylines, precision 5. */
    shapes: string[]
    trips: Record<string, Trip>
}

/** [name, lat, lon], indexed by stop number. */
export type Stops = [string, number, number][]

export type RouteResult =
    | { kind: 'outside' }
    | { kind: 'unreachable' }
    | { kind: 'walk'; best: number; typical: number }
    | { kind: 'missing'; best: number; typical: number }
    | { kind: 'transit'; best: number; typical: number; walk: number; leave: string; arrive: string; boardStop: number; trip: Trip }

export const fmtTime = (min: number) => {
    const m = ((min % 1440) + 1440) % 1440
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** When to leave the clicked point: first departure minus the walk to the stop. */
export const leaveTime = (firstDepart: number, walkMin: number) => fmtTime(firstDepart - walkMin)

/** Cells only exist near walkable ways; a click in a park or on a verge uses the nearest reachable cell. */
const SNAP_CELLS = 2

export function nearestReachable(grid: Grid, i: number): number | null {
    if (grid.fastest[i] !== UNREACHABLE) return i
    const {width, height} = grid.meta
    const x0 = i % width, y0 = Math.floor(i / width)
    let best: number | null = null, bestD = Infinity
    for (let dy = -SNAP_CELLS; dy <= SNAP_CELLS; dy++) {
        for (let dx = -SNAP_CELLS; dx <= SNAP_CELLS; dx++) {
            const x = x0 + dx, y = y0 + dy, d = dx * dx + dy * dy
            if (x < 0 || y < 0 || x >= width || y >= height || d >= bestD) continue
            if (grid.fastest[y * width + x] !== UNREACHABLE) {
                best = y * width + x
                bestD = d
            }
        }
    }
    return best
}

export function resolveRoute(grid: Grid, lat: number, lng: number, routes: Routes): RouteResult {
    const clickedCell = cellAt(grid.meta, lat, lng)
    if (clickedCell === null) return {kind: 'outside'}
    const i = nearestReachable(grid, clickedCell)
    if (i === null) return {kind: 'unreachable'}
    const best = grid.fastest[i]
    const typical = grid.median[i] === UNREACHABLE ? best : grid.median[i]
    const stop = grid.stop[i]
    if (stop === DIRECT_WALK) return {kind: 'walk', best, typical}
    const trip = stop === NO_STOP ? undefined : routes.trips[`${stop}:${grid.sample[i]}`]
    if (!trip) return {kind: 'missing', best, typical}
    const walk = grid.walk[i]
    // MOTIS often starts the trip at a stop next to the grid's (same intersection, other side), with no walk leg
    // between them: the first leg's stop is where you actually board.
    const firstFrom = trip[2][0]?.[1] ?? -1
    const boardStop = firstFrom >= 0 ? firstFrom : stop
    return {kind: 'transit', best, typical, walk, leave: leaveTime(trip[0], walk), arrive: fmtTime(trip[1]), boardStop, trip}
}

const MODE_NAMES: Record<string, string> = {BUS: 'Bus', FERRY: 'Ferry', RAIL: 'Train', REGIONAL_RAIL: 'Train', SUBWAY: 'Train', TRAM: 'Tram'}

export const isWalk = (leg: Leg, routes: Routes) => routes.lines[leg[0]][0] === 'WALK'

/** Route overlay colours: distinct from the teal/violet bands underneath. */
export const MODE_COLORS = {TRAIN: '#2563eb', BUS: '#ea580c', FERRY: '#9333ea', WALK: '#475569', BIKE: '#16a34a'} as const

export function modeColor(mode: string): string {
    if (mode === 'WALK') return MODE_COLORS.WALK
    if (mode === 'FERRY') return MODE_COLORS.FERRY
    if (['RAIL', 'REGIONAL_RAIL', 'SUBWAY', 'METRO', 'TRAM', 'HIGHSPEED_RAIL', 'LONG_DISTANCE'].includes(mode)) return MODE_COLORS.TRAIN
    return MODE_COLORS.BUS
}

export function legLabel(leg: Leg, routes: Routes, stops: Stops | null, isLast: boolean): string {
    const [mode, line, headsign] = routes.lines[leg[0]]
    if (mode === 'WALK') {
        const to = leg[2] >= 0 ? stops?.[leg[2]]?.[0] ?? 'the next stop' : isLast ? 'Perth CBD' : 'your stop'
        return `Walk ${leg[4] - leg[3]} min to ${to}`
    }
    const name = line || MODE_NAMES[mode] || mode
    return headsign ? `${name} → ${headsign}` : name
}

const decoded = new WeakMap<Routes, [number, number][][]>()

/** Leg geometry as [lat, lng] points (a slice of its shared shape). */
export function legGeometry(leg: Leg, routes: Routes): [number, number][] {
    let shapes = decoded.get(routes)
    if (!shapes) {
        shapes = routes.shapes.map(s => decodePolyline(s, 5))
        decoded.set(routes, shapes)
    }
    return shapes[leg[5]].slice(leg[6], leg[7] + 1)
}

function cached<T>(load: (key: string) => Promise<T>) {
    const cache = new Map<string, Promise<T>>()
    return (key: string) => {
        let p = cache.get(key)
        if (!p) {
            p = load(key)
            p.catch(() => cache.delete(key))
            cache.set(key, p)
        }
        return p
    }
}

const stopsLoader = cached(() => fetchJson<Stops>('stops.json'))
export const loadStops = () => stopsLoader('')
export const loadRoutes = cached(key => fetchJson<Routes>(`${key}.routes.json`))
