import {describe, it, expect} from 'vitest'
import {TIMES, parseBands, bandColor, bandLabel, legendTicks} from '../bands'

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

describe('bandColor', () => {
    it('matches the palette endpoints', () => {
        expect(bandColor(10)).toBe('#115e59')
        expect(bandColor(85)).toBe('#ede9fe')
    })

    it('gets steadily lighter from fastest to slowest band', () => {
        const luminance = (hex: string) => {
            const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
                .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        const l = TIMES.map(t => luminance(bandColor(t)))
        for (let i = 1; i < l.length; i++) expect(l[i]).toBeGreaterThan(l[i - 1])
    })

    it('gives every band a distinct colour', () => {
        expect(new Set(TIMES.map(bandColor)).size).toBe(16)
    })
})

describe('bandLabel', () => {
    it('labels the innermost band as "Under"', () => {
        expect(bandLabel(10, 10)).toBe('Under 10 min')
        expect(bandLabel(15, 15)).toBe('Under 15 min')
    })

    it('labels other bands as a range with an en dash', () => {
        expect(bandLabel(45, 15)).toBe('40–45 min')
    })
})

describe('legendTicks', () => {
    it('labels the ends plus every 20 minutes between', () => {
        expect(legendTicks(TIMES)).toEqual([10, 30, 50, 70, 85])
        expect(legendTicks(TIMES.slice(1))).toEqual([15, 30, 50, 70, 85])
    })
})
