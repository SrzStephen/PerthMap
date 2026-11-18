import {useEffect, useState} from 'react'
import {bikeRideAt, loadBike, loadBikeRoutes, type BikeGrid, type BikeRoutes, type RideResult} from './bike'
import type {DataIndex, Grid} from './grid'
import {bikeSpeed, isBikeKey} from './views'

export interface RideDeps {
    loadBike: (index: DataIndex) => Promise<BikeGrid>
    loadBikeRoutes: () => Promise<BikeRoutes>
    resolve: typeof bikeRideAt
}

export interface ClickedRide {
    point: [number, number]
    /** Bike view this result was resolved against (`bike@<speed>`). */
    key: string
    result: RideResult
}

const DEFAULT_DEPS: RideDeps = {loadBike, loadBikeRoutes, resolve: bikeRideAt}

/**
 * The clicked point's ride in the bike view on screen (`loadedKey`, the minutes `grid` at that speed). Null for
 * transit views and until a result for exactly this point and view is ready.
 */
export function useClickedRide(point: [number, number] | null, grid: Grid | null, loadedKey: string | null,
                               index: DataIndex | null, deps: RideDeps = DEFAULT_DEPS): ClickedRide | null {
    const [resolved, setResolved] = useState<ClickedRide | null>(null)
    const bikeKey = isBikeKey(loadedKey) ? loadedKey : null

    useEffect(() => {
        if (!point || !grid || !bikeKey || !index?.bike) return
        let cancelled = false
        const ref = index.bike.refSpeedKmh
        const speed = bikeSpeed(bikeKey)
        deps.loadBike(index)
            .then(async bike => {
                const routes = await deps.loadBikeRoutes().catch(e => {
                    console.error('loading bike routes', e)
                    return null // the grid alone still gives time and distance
                })
                if (!cancelled) setResolved({point, key: bikeKey, result: deps.resolve(grid, bike, routes, point[0], point[1], speed, ref)})
            })
            .catch(e => console.error('loading bike grid', e))
        return () => {
            cancelled = true
        }
    }, [point, grid, bikeKey, index, deps])

    if (!resolved || !point || resolved.key !== bikeKey || resolved.point !== point) return null
    return resolved
}
