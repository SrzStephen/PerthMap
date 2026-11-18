import {act, renderHook, waitFor} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'
import type {Band} from '../bands'
import type {DataIndex, Grid} from '../grid'
import {useWindowData, type WindowDeps} from '../useWindowData'

const INDEX: DataIndex = {
    version: 1, generated: '', grid: {width: 1, height: 1, minLon: 0, minLat: 0, spacing: 1},
    days: [{key: 'weekday', label: 'Weekday', date: '2026-11-25'}], hours: [6, 7, 8, 9, 10, 21],
}
const fakeGrid = (key: string) => ({key} as unknown as Grid)
const bandsFor = (g: Grid): Band[] => [{time: 15, positions: [[[[0, 0]]]], key: (g as unknown as {key: string}).key} as unknown as Band]
const keyOf = (bands: Band[]) => (bands[0] as unknown as {key: string} | undefined)?.key

function deferred<T>() {
    let resolve!: (v: T) => void, reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return {promise, resolve, reject}
}

function deps(overrides: Partial<WindowDeps> = {}): WindowDeps {
    return {
        loadGrid: vi.fn(async (_i: DataIndex, key: string) => fakeGrid(key)),
        evictGrid: vi.fn(),
        computeBands: vi.fn(async (g: Grid) => bandsFor(g)),
        ...overrides,
    }
}

describe('useWindowData', () => {
    it('loads then ready', async () => {
        const d = deps()
        const {result} = renderHook(() => useWindowData(INDEX, 'weekday', 8, d))
        expect(result.current.status).toBe('loading')
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(keyOf(result.current.bands)).toBe('weekday-08')
        expect(d.loadGrid).toHaveBeenCalledWith(INDEX, 'weekday-08')
    })

    it('keeps previous bands while loading', async () => {
        const next = deferred<Grid>()
        const d = deps({loadGrid: vi.fn(async (_i: DataIndex, key: string) => key === 'weekday-09' ? next.promise : fakeGrid(key))})
        const {result, rerender} = renderHook(({h}) => useWindowData(INDEX, 'weekday', h, d), {initialProps: {h: 8}})
        await waitFor(() => expect(result.current.status).toBe('ready'))
        rerender({h: 9})
        expect(result.current.status).toBe('loading')
        expect(keyOf(result.current.bands)).toBe('weekday-08')
        await act(async () => next.resolve(fakeGrid('weekday-09')))
        await waitFor(() => expect(keyOf(result.current.bands)).toBe('weekday-09'))
    })

    it('stale window load is ignored', async () => {
        const slow = deferred<Grid>(), fast = deferred<Grid>()
        const d = deps({loadGrid: vi.fn((_i: DataIndex, key: string) => key === 'weekday-08' ? slow.promise : fast.promise)})
        const {result, rerender} = renderHook(({h}) => useWindowData(INDEX, 'weekday', h, d), {initialProps: {h: 8}})
        rerender({h: 9})
        await act(async () => fast.resolve(fakeGrid('weekday-09')))
        await waitFor(() => expect(result.current.status).toBe('ready'))
        await act(async () => slow.resolve(fakeGrid('weekday-08')))
        expect(keyOf(result.current.bands)).toBe('weekday-09')
        expect((result.current.grid as unknown as {key: string}).key).toBe('weekday-09')
    })

    it('error then retry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        let fail = true
        const d = deps({loadGrid: vi.fn(async (_i: DataIndex, key: string) => {
            if (fail) throw new Error('boom')
            return fakeGrid(key)
        })})
        const {result} = renderHook(() => useWindowData(INDEX, 'weekday', 8, d))
        await waitFor(() => expect(result.current.status).toBe('error'))
        fail = false
        act(() => result.current.retry())
        expect(d.evictGrid).toHaveBeenCalledWith('weekday-08')
        await waitFor(() => expect(result.current.status).toBe('ready'))
    })

    it('prefetches neighbours', async () => {
        const d = deps()
        const {result} = renderHook(() => useWindowData(INDEX, 'weekday', 8, d))
        await waitFor(() => expect(result.current.status).toBe('ready'))
        await waitFor(() => {
            const keys = (d.loadGrid as ReturnType<typeof vi.fn>).mock.calls.map(c => c[1])
            expect(keys).toEqual(expect.arrayContaining(['weekday-07', 'weekday-09']))
        })
    })

    it('waits for the index', () => {
        const d = deps()
        const {result} = renderHook(() => useWindowData(null, 'weekday', 8, d))
        expect(result.current.status).toBe('loading')
        expect(d.loadGrid).not.toHaveBeenCalled()
    })
})
