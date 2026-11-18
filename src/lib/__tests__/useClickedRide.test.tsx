import {renderHook, waitFor} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'
import type {BikeGrid, BikeRoutes, RideResult} from '../bike'
import type {DataIndex, Grid} from '../grid'
import {useClickedRide, type RideDeps} from '../useClickedRide'

const INDEX = {grid: {width: 1, height: 1, minLon: 0, minLat: 0, spacing: 1}, bike: {refSpeedKmh: 15}} as unknown as DataIndex
const GRID = {} as Grid
const P: [number, number] = [1, 2]

function deps(over: Partial<RideDeps> = {}): RideDeps {
    return {
        loadBike: vi.fn(async () => ({} as BikeGrid)),
        loadBikeRoutes: vi.fn(async () => ({} as BikeRoutes)),
        resolve: vi.fn((_m, _b, routes, _lat, _lng, speed: number) =>
            ({kind: 'missing', minutes: routes ? 1 : 0, metres: 0, speed}) as RideResult),
        ...over,
    }
}

describe('useClickedRide', () => {
    it('resolves for a bike key at its speed', async () => {
        const d = deps()
        const {result} = renderHook(() => useClickedRide(P, GRID, 'bike@15', INDEX, d))
        await waitFor(() => expect(result.current?.result).toEqual({kind: 'missing', minutes: 1, metres: 0, speed: 15}))
        expect(result.current?.point).toBe(P)
        expect(d.resolve).toHaveBeenCalledWith(GRID, expect.anything(), expect.anything(), 1, 2, 15, 15)
    })

    it('re-resolves when the speed changes', async () => {
        const d = deps()
        const {result, rerender} = renderHook(({k}) => useClickedRide(P, GRID, k, INDEX, d), {initialProps: {k: 'bike@15'}})
        await waitFor(() => expect(result.current?.key).toBe('bike@15'))
        rerender({k: 'bike@25'})
        expect(result.current).toBeNull()
        await waitFor(() => expect(result.current?.result).toMatchObject({speed: 25}))
    })

    it('ignores transit keys', () => {
        const d = deps()
        const {result} = renderHook(() => useClickedRide(P, GRID, 'weekday-08', INDEX, d))
        expect(result.current).toBeNull()
        expect(d.loadBike).not.toHaveBeenCalled()
    })

    it('still resolves when the routes fail to load', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const d = deps({loadBikeRoutes: vi.fn(async () => { throw new Error('boom') })})
        const {result} = renderHook(() => useClickedRide(P, GRID, 'bike@15', INDEX, d))
        await waitFor(() => expect(result.current?.result).toMatchObject({minutes: 0}))
    })
})
