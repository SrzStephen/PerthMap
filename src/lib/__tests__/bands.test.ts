import {describe, it, expect} from 'vitest'
import {TIMES, parseBands, visibleBands, bandColor, bandLabel} from '../bands'

const ring = [[115.8, -31.9], [115.9, -31.9], [115.9, -32.0], [115.8, -31.9]]
const feature = (time: number | string, type = 'Polygon') => ({
    properties: {time},
    geometry: {type, coordinates: [ring]},
})

describe('TIMES', () => {
    it('lists the 16 band times from 10 to 85', () => {
        expect(TIMES).toHaveLength(16)
        expect(TIMES[0]).toBe(10)
        expect(TIMES[15]).toBe(85)
    })
})

describe('parseBands', () => {
    it('sorts bands by time descending', () => {
        const bands = parseBands({features: [feature(10), feature(85), feature(40)]})
        expect(bands.map(b => b.time)).toEqual([85, 40, 10])
    })

    it('swaps [lng, lat] to [lat, lng]', () => {
        const [band] = parseBands({features: [feature(10)]})
        expect(band.positions[0][0]).toEqual([-31.9, 115.8])
    })

    it('coerces string times to numbers', () => {
        const [band] = parseBands({features: [feature('25')]})
        expect(band.time).toBe(25)
    })

    it('skips non-Polygon geometries', () => {
        const bands = parseBands({features: [feature(10), feature(20, 'MultiPolygon')]})
        expect(bands.map(b => b.time)).toEqual([10])
    })
})

describe('visibleBands', () => {
    const bands = parseBands({features: TIMES.map(t => feature(t))})

    it('shows only the 10 band at minimum', () => {
        expect(visibleBands(bands, 10).map(b => b.time)).toEqual([10])
    })

    it('shows all bands at maximum', () => {
        expect(visibleBands(bands, 85)).toHaveLength(16)
    })

    it('is inclusive and keeps largest-first order', () => {
        expect(visibleBands(bands, 40).map(b => b.time)).toEqual([40, 35, 30, 25, 20, 15, 10])
    })
})

describe('bandColor', () => {
    it('matches the palette endpoints', () => {
        expect(bandColor(10)).toBe('#0f766e')
        expect(bandColor(85)).toBe('#ddd6fe')
    })

    it('gives every band a distinct colour', () => {
        expect(new Set(TIMES.map(bandColor)).size).toBe(16)
    })
})

describe('bandLabel', () => {
    it('labels the innermost band', () => {
        expect(bandLabel(10)).toBe('Under 10 min')
    })

    it('labels a range with an en dash', () => {
        expect(bandLabel(45)).toBe('40–45 min')
    })
})
