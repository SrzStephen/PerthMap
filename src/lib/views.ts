/** What the map shows: a transit window, or bike times at a speed. Both load as a `Grid` of minutes. */
import {bikeMinutes, evictBike, loadBike} from './bike'
import {evictGrid, loadGrid, windowKey, type DataIndex, type DayKey, type Grid} from './grid'

export type View = { mode: 'transit'; day: DayKey; hour: number } | { mode: 'bike'; speed: number }

const BIKE = 'bike@'

export const viewKey = (v: View) => v.mode === 'bike' ? `${BIKE}${v.speed}` : windowKey(v.day, v.hour)

export const isBikeKey = (key: string | null): key is string => !!key?.startsWith(BIKE)

/** Speed (km/h) of a bike key. */
export const bikeSpeed = (key: string) => Number(key.slice(BIKE.length))

export function loadView(index: DataIndex, key: string): Promise<Grid> {
    if (!isBikeKey(key)) return loadGrid(index, key)
    const bike = index.bike
    if (!bike) return Promise.reject(new Error('no bike data in index.json'))
    return loadBike(index).then(b => bikeMinutes(b, bikeSpeed(key), bike.refSpeedKmh))
}

export function evictView(key: string): void {
    if (isBikeKey(key)) evictBike()
    else evictGrid(key)
}
