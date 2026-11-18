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

export function resolveRoute(grid: Grid, lat: number, lng: number, routes: Routes): RouteResult {
    const i = cellAt(grid.meta, lat, lng)
    if (i === null) return {kind: 'outside'}
    const best = grid.fastest[i]
    if (best === UNREACHABLE) return {kind: 'unreachable'}
    const typical = grid.median[i] === UNREACHABLE ? best : grid.median[i]
    const stop = grid.stop[i]
    if (stop === DIRECT_WALK) return {kind: 'walk', best, typical}
    const trip = stop === NO_STOP ? undefined : routes.trips[`${stop}:${grid.sample[i]}`]
    if (!trip) return {kind: 'missing', best, typical}
    const walk = grid.walk[i]
    return {kind: 'transit', best, typical, walk, leave: leaveTime(trip[0], walk), arrive: fmtTime(trip[1]), boardStop: stop, trip}
}

const MODE_NAMES: Record<string, string> = {BUS: 'Bus', FERRY: 'Ferry', RAIL: 'Train', REGIONAL_RAIL: 'Train', SUBWAY: 'Train', TRAM: 'Tram'}

export const isWalk = (leg: Leg, routes: Routes) => routes.lines[leg[0]][0] === 'WALK'

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
