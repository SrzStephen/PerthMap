import {describe, expect, it} from 'vitest'
import {buildBands, waterFromGeoJSON} from '../contours'
import type {Band} from '../bands'
import type {Grid, GridMeta} from '../grid'

const META: GridMeta = {width: 6, height: 6, minLon: 0, minLat: 0, spacing: 1}

function grid(median: (x: number, y: number) => number, meta = META): Grid {
    const n = meta.width * meta.height
    const m = new Uint8Array(n)
    for (let y = 0; y < meta.height; y++) for (let x = 0; x < meta.width; x++) m[y * meta.width + x] = median(x, y)
    return {meta, median: m, fastest: m, sample: new Uint8Array(n), walk: new Uint8Array(n), stop: new Uint16Array(n)}
}

/** Polygon area (outer minus holes) in (lat, lng) units. */
function ringArea(ring: [number, number][]) {
    let a = 0
    for (let i = 0; i < ring.length; i++) {
        const [y1, x1] = ring[i], [y2, x2] = ring[(i + 1) % ring.length]
        a += x1 * y2 - x2 * y1
    }
    return Math.abs(a) / 2
}
const bandArea = (b: Band) => b.positions.reduce((s, [outer, ...holes]) =>
    s + ringArea(outer) - holes.reduce((h, r) => h + ringArea(r), 0), 0)

// distance-like travel times from the grid's middle: 10 at the centre rising to ~ 30 at the corners
const radial = grid((x, y) => 10 + Math.round(5 * Math.hypot(x - 2.5, y - 2.5)))

describe('buildBands', () => {
    it('largest first', () => {
        expect(buildBands(radial, [15, 20], null).map(b => b.time)).toEqual([20, 15])
    })

    it('nesting', () => {
        const [b20, b15] = buildBands(radial, [15, 20], null)
        expect(bandArea(b20)).toBeGreaterThan(bandArea(b15))
        expect(bandArea(b15)).toBeGreaterThan(0)
    })

    it('band encloses only cells under the threshold', () => {
        // cells with 14 vs 15: "under 15" must include the 14s and exclude the 15s
        const half = grid(x => (x < 3 ? 14 : 15))
        const [b] = buildBands(half, [15], null)
        const lngs = b.positions.flatMap(p => p[0].map(([, lng]) => lng))
        expect(Math.max(...lngs)).toBeLessThanOrEqual(2.5 + 1e-9)
        expect(Math.min(...lngs)).toBeLessThanOrEqual(0)
    })

    it('vertex transform', () => {
        const one = grid((x, y) => (x === 2 && y === 3 ? 10 : 255))
        const [b] = buildBands(one, [15], null)
        for (const [lat, lng] of b.positions.flat(2) as unknown as [number, number][]) {
            expect(Math.abs(lat - 3)).toBeLessThanOrEqual(1)
            expect(Math.abs(lng - 2)).toBeLessThanOrEqual(1)
        }
    })

    it('all unreachable gives no bands', () => {
        expect(buildBands(grid(() => 255), [15, 20], null)).toEqual([])
    })

    it('water clip removes area', () => {
        const all = grid(() => 10)
        const [full] = buildBands(all, [15], null)
        const water = waterFromGeoJSON({
            type: 'FeatureCollection',
            features: [{type: 'Feature', properties: {}, geometry: {
                type: 'Polygon', coordinates: [[[-5, -5], [2.5, -5], [2.5, 10], [-5, 10], [-5, -5]]],
            }}],
        })
        const [clipped] = buildBands(all, [15], water)
        const ratio = bandArea(clipped) / bandArea(full)
        expect(ratio).toBeGreaterThan(0.4)
        expect(ratio).toBeLessThan(0.6)
    })
})
