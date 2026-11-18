import {useEffect, useState} from 'react'
import type {DataIndex, Grid} from './grid'
import {loadRoutes, loadStops, resolveRoute, type RouteResult, type Routes, type Stops} from './route'

export interface RouteDeps {
    loadRoutes: (key: string) => Promise<Routes>
    loadStops: () => Promise<Stops>
    resolve: (grid: Grid, lat: number, lng: number, routes: Routes) => RouteResult
}

export interface ClickedRoute {
    point: [number, number]
    /** Window this result was resolved against. */
    key: string
    dayLabel: string
    result: RouteResult
    routes: Routes | null
    stops: Stops | null
}

const DEFAULT_DEPS: RouteDeps = {loadRoutes, loadStops, resolve: resolveRoute}
const NO_ROUTES: Routes = {samples: [], lines: [], shapes: [], trips: {}}

/**
 * The clicked point's route in the window the map is showing (`loadedKey`). Returns null until a result for exactly
 * this point and window is ready, so the panel never shows another window's route or day, or an earlier click.
 */
export function useClickedRoute(point: [number, number] | null, grid: Grid | null, loadedKey: string | null,
                                days: DataIndex['days'], deps: RouteDeps = DEFAULT_DEPS): ClickedRoute | null {
    const [resolved, setResolved] = useState<ClickedRoute | null>(null)

    useEffect(() => {
        if (!point || !grid || !loadedKey) return
        let cancelled = false
        const day = loadedKey.slice(0, loadedKey.lastIndexOf('-'))
        const dayLabel = days.find(d => d.key === day)?.label ?? day
        const done = (routes: Routes | null, stops: Stops | null) => !cancelled && setResolved({
            point, key: loadedKey, dayLabel, routes, stops,
            result: deps.resolve(grid, point[0], point[1], routes ?? NO_ROUTES),
        })
        Promise.all([deps.loadRoutes(loadedKey), deps.loadStops()])
            .then(([routes, stops]) => done(routes, stops))
            .catch(e => {
                console.error('loading route data', e)
                done(null, null) // the grid alone still gives the times and outside / unreachable / walk
            })
        return () => {
            cancelled = true
        }
    }, [point, grid, loadedKey, days, deps])

    if (!resolved || !point || resolved.key !== loadedKey || resolved.point !== point) return null
    return resolved
}
