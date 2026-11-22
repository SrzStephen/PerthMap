import {describe, expect, it} from 'vitest'
import type {Grid, GridMeta} from '../grid'
import {DIRECT_WALK, NO_STOP, UNREACHABLE} from '../grid'
import {fmtTime, legGeometry, legLabel, leaveTime, resolveRoute, type Routes, type Stops} from '../route'

const META: GridMeta = {width: 3, height: 1, minLon: 115, minLat: -32, spacing: 0.01}

function grid(cells: { median: number; fastest: number; sample: number; walk: number; stop: number }[]): Grid {
    const p = (k: keyof typeof cells[0]) => cells.map(c => c[k])
    return {
        meta: META,
        median: Uint8Array.from(p('median')), fastest: Uint8Array.from(p('fastest')), sample: Uint8Array.from(p('sample')),
        walk: Uint8Array.from(p('walk')), stop: Uint16Array.from(p('stop')),
    }
}

// shape 0: three points north along 115.80
const ROUTES: Routes = {
    samples: ['08:00', '08:05', '08:10', '08:15'],
    lines: [['BUS', '950', 'UWA'], ['WALK', '', '']],
    shapes: ['_p~iF~ps|U_ulLnnqC_mqNvxq`@'],
    trips: {
        // leaves stop 12 at 07:28, bus to stop 4 07:28–07:51, walk 07:51–08:00 to the CBD
        '12:3': [448, 480, [[0, 12, 4, 448, 471, 0, 0, 1], [1, 4, -1, 471, 480, 0, 1, 2]]],
    },
}
const STOPS: Stops = [['A', 0, 0], ['B', 0, 0], ['C', 0, 0], ['D', 0, 0], ['Elizabeth Quay Stn', -31.95, 115.85]]

const G = grid([
    {median: 46, fastest: 38, sample: 3, walk: 6, stop: 12},
    {median: 20, fastest: 18, sample: 0, walk: 18, stop: DIRECT_WALK},
    {median: UNREACHABLE, fastest: UNREACHABLE, sample: 255, walk: 255, stop: NO_STOP},
])

describe('resolveRoute', () => {
    it('outside the grid', () => {
        expect(resolveRoute(G, -31, 115, ROUTES)).toEqual({kind: 'outside'})
    })

    it('unreachable cell with nothing reachable nearby', () => {
        const none = {median: UNREACHABLE, fastest: UNREACHABLE, sample: 255, walk: 255, stop: NO_STOP}
        expect(resolveRoute(grid([none, none, none]), -32, 115.02, ROUTES)).toEqual({kind: 'unreachable'})
    })

    it('direct walk', () => {
        expect(resolveRoute(G, -32, 115.01, ROUTES)).toEqual({kind: 'walk', best: 18, typical: 20})
    })

    it('missing trip', () => {
        const g = grid([{median: 46, fastest: 38, sample: 2, walk: 6, stop: 12}, {median: 0, fastest: 0, sample: 0, walk: 0, stop: 0}, {median: 0, fastest: 0, sample: 0, walk: 0, stop: 0}])
        expect(resolveRoute(g, -32, 115, ROUTES)).toEqual({kind: 'missing', best: 38, typical: 46})
    })

    it('transit', () => {
        const r = resolveRoute(G, -32, 115, ROUTES)
        expect(r).toMatchObject({kind: 'transit', best: 38, typical: 46, walk: 6, leave: '07:22', arrive: '08:00', boardStop: 12})
        expect(r.kind === 'transit' && r.trip).toBe(ROUTES.trips['12:3'])
    })

    it('snaps an unwalkable cell to the nearest reachable cell within 2 cells', () => {
        const meta: GridMeta = {width: 5, height: 1, minLon: 115, minLat: -32, spacing: 0.01}
        const empty = {median: UNREACHABLE, fastest: UNREACHABLE, sample: 255, walk: 255, stop: NO_STOP}
        const walk = {median: 20, fastest: 18, sample: 0, walk: 18, stop: DIRECT_WALK}
        const cells = [walk, empty, empty, empty, empty]
        const g: Grid = {
            meta,
            median: Uint8Array.from(cells.map(c => c.median)), fastest: Uint8Array.from(cells.map(c => c.fastest)),
            sample: Uint8Array.from(cells.map(c => c.sample)), walk: Uint8Array.from(cells.map(c => c.walk)),
            stop: Uint16Array.from(cells.map(c => c.stop)),
        }
        expect(resolveRoute(g, -32, 115.02, ROUTES)).toEqual({kind: 'walk', best: 18, typical: 20})
        expect(resolveRoute(g, -32, 115.03, ROUTES)).toEqual({kind: 'unreachable'})
    })

    it('boards at the first leg stop when MOTIS starts the trip at a nearby stop', () => {
        // grid says stop 12, but the plan's first leg leaves from stop 7 (e.g. "Scott Rd After" vs "Before")
        const routes: Routes = {...ROUTES, trips: {'12:3': [448, 480, [[0, 7, 4, 448, 471, 0, 0, 1]]]}}
        expect(resolveRoute(G, -32, 115, routes)).toMatchObject({kind: 'transit', boardStop: 7})
    })

    it('typical falls back to best when the median is missing', () => {
        const g = grid([{median: UNREACHABLE, fastest: 38, sample: 3, walk: 6, stop: 12}, {median: 0, fastest: 0, sample: 0, walk: 0, stop: 0}, {median: 0, fastest: 0, sample: 0, walk: 0, stop: 0}])
        expect(resolveRoute(g, -32, 115, ROUTES)).toMatchObject({kind: 'transit', typical: 38})
    })
})

describe('times', () => {
    it('formats minutes since midnight', () => {
        expect(fmtTime(448)).toBe('07:28')
        expect(fmtTime(1440 + 5)).toBe('00:05')
    })

    it('leaveTime wraps past midnight', () => {
        expect(leaveTime(4, 6)).toBe('23:58')
        expect(leaveTime(448, 6)).toBe('07:22')
    })
})

describe('legLabel', () => {
    const [bus, walk] = ROUTES.trips['12:3'][2]

    it('labels a transit leg with line and headsign', () => {
        expect(legLabel(bus, ROUTES, STOPS, false)).toBe('950 → UWA')
    })

    it('walk-to-cbd leg label', () => {
        expect(legLabel(walk, ROUTES, STOPS, true)).toBe('Walk 9 min to Perth CBD')
    })

    it('names the stop a walk ends at', () => {
        expect(legLabel([1, -1, 4, 400, 404, 0, 0, 1], ROUTES, STOPS, false)).toBe('Walk 4 min to Elizabeth Quay Stn')
    })
})

describe('legGeometry', () => {
    it('slices the shared shape', () => {
        const [bus, walk] = ROUTES.trips['12:3'][2]
        expect(legGeometry(bus, ROUTES)).toEqual([[38.5, -120.2], [40.7, -120.95]])
        expect(legGeometry(walk, ROUTES)).toEqual([[40.7, -120.95], [43.252, -126.453]])
    })
})
