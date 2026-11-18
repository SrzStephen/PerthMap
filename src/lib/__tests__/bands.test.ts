import {describe, it, expect} from 'vitest'
import {TIMES, THRESHOLDS, bandColor, legendTicks} from '../bands'

describe('TIMES', () => {
    it('lists the 16 band times from 10 to 85', () => {
        expect(TIMES).toHaveLength(16)
        expect(TIMES[0]).toBe(10)
        expect(TIMES[15]).toBe(85)
    })
})

describe('THRESHOLDS', () => {
    it('contours every 5 minutes from 15 to 85', () => {
        expect(THRESHOLDS[0]).toBe(15)
        expect(THRESHOLDS[THRESHOLDS.length - 1]).toBe(85)
        expect(THRESHOLDS).toHaveLength(15)
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

describe('legendTicks', () => {
    it('labels the ends plus every 20 minutes between', () => {
        expect(legendTicks(TIMES)).toEqual([10, 30, 50, 70, 85])
        expect(legendTicks(THRESHOLDS)).toEqual([15, 30, 50, 70, 85])
    })
})
