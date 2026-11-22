import {act, renderHook, waitFor} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'
import type {DataIndex, Grid} from '../grid'
import type {Routes, Stops} from '../route'
import {useClickedRoute, type RouteDeps} from '../useClickedRoute'

const DAYS: DataIndex['days'] = [
    {key: 'weekday', label: 'Weekday', date: '2026-11-25'},
    {key: 'sunday', label: 'Sunday', date: '2026-11-22'},
]
const GRID = {meta: {width: 1, height: 1, minLon: 0, minLat: 0, spacing: 1}} as unknown as Grid
const P: [number, number] = [1, 2]
const routesFor = (key: string) => ({key} as unknown as Routes)

function deferred<T>() {
    let resolve!: (v: T) => void
    const promise = new Promise<T>(res => { resolve = res })
    return {promise, resolve}
}

function deps(loadRoutes: RouteDeps['loadRoutes'] = async k => routesFor(k)): RouteDeps {
    return {
        loadRoutes: vi.fn(loadRoutes),
        loadStops: vi.fn(async () => [] as Stops),
        resolve: vi.fn((_g: Grid, lat: number, _lng: number, r: Routes) =>
            ({kind: 'walk', best: lat, typical: (r as unknown as {key: string}).key.length}) as const),
    }
}

describe('useClickedRoute', () => {
    it('labels the panel with the day of the window on screen, not the selected day', async () => {
        const d = deps()
        const {result} = renderHook(() => useClickedRoute(P, GRID, 'weekday-08', DAYS, d))
        await waitFor(() => expect(result.current).not.toBeNull())
        expect(result.current?.dayLabel).toBe('Weekday')
    })

    it('hides the panel until the new window’s routes are loaded', async () => {
        const sunday = deferred<Routes>()
        const d = deps(async k => (k === 'sunday-08' ? sunday.promise : routesFor(k)))
        const {result, rerender} = renderHook(({key}) => useClickedRoute(P, GRID, key, DAYS, d),
            {initialProps: {key: 'weekday-08'}})
        await waitFor(() => expect(result.current?.dayLabel).toBe('Weekday'))
        rerender({key: 'sunday-08'})
        expect(result.current).toBeNull()
        await act(async () => sunday.resolve(routesFor('sunday-08')))
        await waitFor(() => expect(result.current?.dayLabel).toBe('Sunday'))
    })

    it('never shows a result for a previous click', async () => {
        const d = deps()
        const {result, rerender} = renderHook(({p}) => useClickedRoute(p, GRID, 'weekday-08', DAYS, d),
            {initialProps: {p: [1, 2] as [number, number]}})
        await waitFor(() => expect(result.current?.point).toEqual([1, 2]))
        rerender({p: [5, 6]})
        expect(result.current === null || result.current.point[0] === 5).toBe(true)
        await waitFor(() => expect(result.current?.point).toEqual([5, 6]))
    })

    it('nothing clicked', () => {
        const {result} = renderHook(() => useClickedRoute(null, GRID, 'weekday-08', DAYS, deps()))
        expect(result.current).toBeNull()
    })
})
