import {useCallback, useEffect, useRef, useState} from 'react'
import {THRESHOLDS, type Band} from './bands'
import {buildBands} from './contours'
import {windowKey, type DataIndex, type Grid} from './grid'
import {evictView, loadView, viewKey, type View} from './views'

export type WindowStatus = 'loading' | 'ready' | 'error'

export interface WindowDeps {
    loadGrid: (index: DataIndex, key: string) => Promise<Grid>
    evictGrid: (key: string) => void
    computeBands: (grid: Grid) => Promise<Band[]>
}

let worker: Worker | null | undefined
let nextId = 0
const pending = new Map<number, { resolve: (b: Band[]) => void; reject: (e: Error) => void }>()

/** Bands from a Web Worker; falls back to the main thread if workers are unavailable or fail. */
export function computeBandsInWorker(grid: Grid): Promise<Band[]> {
    if (worker === undefined) {
        try {
            worker = typeof Worker === 'undefined' ? null
                : new Worker(new URL('./contours.worker.ts', import.meta.url), {type: 'module'})
            worker?.addEventListener('message', (e: MessageEvent<{ id: number; bands?: Band[]; error?: string }>) => {
                const p = pending.get(e.data.id)
                pending.delete(e.data.id)
                if (e.data.bands) p?.resolve(e.data.bands)
                else p?.reject(new Error(e.data.error))
            })
            worker?.addEventListener('error', e => {
                console.error('contour worker failed, using main thread', e)
                worker = null
                pending.forEach(p => p.reject(new Error('worker failed')))
                pending.clear()
            })
        } catch (e) {
            console.error('contour worker unavailable, using main thread', e)
            worker = null
        }
    }
    const w = worker
    if (!w) return Promise.resolve(buildBands(grid, THRESHOLDS, null))
    const id = nextId++
    return new Promise<Band[]>((resolve, reject) => {
        pending.set(id, {resolve, reject})
        w.postMessage({id, grid, thresholds: THRESHOLDS, water: null})
    }).catch(() => buildBands(grid, THRESHOLDS, null))
}

const DEFAULT_DEPS: WindowDeps = {loadGrid: loadView, evictGrid: evictView, computeBands: computeBandsInWorker}

/** Grid + bands for one view (transit window or bike speed). Previous grid/bands stay while the next loads or after an error. */
export function useWindowData(index: DataIndex | null, view: View, deps: WindowDeps = DEFAULT_DEPS) {
    const [grid, setGrid] = useState<Grid | null>(null)
    const [bands, setBands] = useState<Band[]>([])
    const [status, setStatus] = useState<WindowStatus>('loading')
    const [loadedKey, setLoadedKey] = useState<string | null>(null)
    const [attempt, setAttempt] = useState(0)
    const latest = useRef(0)
    const bandCache = useRef(new Map<string, Band[]>())
    const depsRef = useRef(deps)
    depsRef.current = deps
    const key = viewKey(view)
    const day = view.mode === 'transit' ? view.day : null
    const hour = view.mode === 'transit' ? view.hour : null

    useEffect(() => {
        if (!index) return
        const request = ++latest.current
        const d = depsRef.current
        setStatus('loading')
        d.loadGrid(index, key)
            .then(async g => {
                // scrubbing: don't queue contour jobs (~0.5 s each) for windows already superseded
                if (request !== latest.current) return
                let b = bandCache.current.get(key)
                if (!b) {
                    b = await d.computeBands(g)
                    bandCache.current.set(key, b)
                }
                if (request !== latest.current) return
                setGrid(g)
                setBands(b)
                setLoadedKey(key)
                setStatus('ready')
                if (day !== null && hour !== null) {
                    for (const h of [hour - 1, hour + 1]) {
                        if (index.hours.includes(h)) d.loadGrid(index, windowKey(day, h)).catch(() => undefined)
                    }
                }
            })
            .catch(e => {
                if (request !== latest.current) return
                console.error(`loading ${key}`, e)
                setStatus('error')
            })
    }, [index, key, day, hour, attempt])

    const retry = useCallback(() => {
        depsRef.current.evictGrid(key)
        bandCache.current.delete(key)
        setAttempt(a => a + 1)
    }, [key])

    /** loadedKey: view the current grid/bands belong to (lags `view` while loading). */
    return {grid, bands, status, retry, loadedKey}
}
