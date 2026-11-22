/** Hazard and noise filters: each active filter keeps the cells that pass; all of them combine with AND. */
import type {AttrData} from './attrs'

export interface FilterDef {
    id: string
    field: string
    label: string
    thresholds?: number[]
    /** Shown after a threshold, e.g. "200 m". */
    unit?: string
    defaultThreshold?: number
    passes: (v: number, t: number) => boolean
}

export const FILTERS: FilterDef[] = [
    {id: 'bushfire', field: 'bushfire', label: 'Not bushfire prone', passes: v => v === 0},
    {id: 'power', field: 'power_m', label: 'Away from powerlines', thresholds: [100, 200, 500], unit: ' m',
        defaultThreshold: 200, passes: (v, t) => v >= t},
    {id: 'traffic', field: 'traffic_k', label: 'No busy road within 200 m', thresholds: [10, 20, 40], unit: 'k/day',
        defaultThreshold: 20, passes: (v, t) => v < t},
    {id: 'acid', field: 'acid', label: 'No high acid sulfate risk', passes: v => v !== 1},
    {id: 'noise', field: 'noise', label: 'Outside road/rail noise areas', passes: v => v === 0},
]

/** Filter id → threshold (0 for filters without one). */
export type ActiveFilters = Record<string, number>

export const availableFilters = (data: AttrData) => FILTERS.filter(f => f.field in data.fields)

/** 1 where every active, available filter passes; null when none is active. */
export function filterMask(data: AttrData, active: ActiveFilters): Uint8Array | null {
    const on = availableFilters(data).filter(f => f.id in active)
    if (!on.length) return null
    const n = data.fields[on[0].field].length
    const mask = new Uint8Array(n).fill(1)
    for (const f of on) {
        const plane = data.fields[f.field], t = active[f.id]
        for (let i = 0; i < n; i++) if (mask[i] && !f.passes(plane[i], t)) mask[i] = 0
    }
    return mask
}

export function andMasks(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
    if (!a) return b
    if (!b) return a
    return a.map((v, i) => v & b[i])
}
