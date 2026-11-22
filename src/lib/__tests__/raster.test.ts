import {describe, expect, it} from 'vitest'
import type {GridMeta} from '../grid'
import {LAYER_STYLES, rasterBounds, rasterPixels} from '../raster'

const META: GridMeta = {width: 2, height: 3, minLon: 115, minLat: -32, spacing: 0.01}

describe('rasterPixels', () => {
    it('puts the south row at the bottom of the image', () => {
        const values = Uint8Array.from([0, 1, 0, 0, 0, 0])  // row 0 (south), column 1
        const px = rasterPixels(values, META, v => (v ? [1, 2, 3, 4] : null))
        expect(px.length).toBe(2 * 3 * 4)
        const at = (row: number, col: number) => [...px.slice((row * 2 + col) * 4, (row * 2 + col) * 4 + 4)]
        expect(at(2, 1)).toEqual([1, 2, 3, 4])
        const alphas = [...px].filter((_, i) => i % 4 === 3)
        expect(alphas.filter(a => a !== 0)).toEqual([4])
    })
})

describe('rasterBounds', () => {
    it('spans half a cell beyond the outer centres', () => {
        const [[s, w], [n, e]] = rasterBounds(META)
        expect(s).toBeCloseTo(-32.005)
        expect(w).toBeCloseTo(114.995)
        expect(n).toBeCloseTo(-31.975)
        expect(e).toBeCloseTo(115.015)
    })
})

describe('LAYER_STYLES', () => {
    it('colours flagged cells only', () => {
        expect(LAYER_STYLES.bushfire(0)).toBeNull()
        expect(LAYER_STYLES.bushfire(1)).not.toBeNull()
        expect(LAYER_STYLES.acid(1)![3]).toBeGreaterThan(LAYER_STYLES.acid(2)![3])
        expect(LAYER_STYLES.noise(3)).not.toBeNull()
    })
})
