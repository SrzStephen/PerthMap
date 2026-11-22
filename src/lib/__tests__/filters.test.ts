import {describe, expect, it} from 'vitest'
import type {AttrData} from '../attrs'
import {FILTERS, andMasks, availableFilters, filterMask} from '../filters'

const def = (id: string) => FILTERS.find(f => f.id === id)!

function data(fields: AttrData['fields']): AttrData {
    return {fields, layers: [], localStatus: 'off'}
}

describe('FILTERS', () => {
    it('power passes at the threshold, not below', () => {
        expect(def('power').passes(200, 200)).toBe(true)
        expect(def('power').passes(199, 200)).toBe(false)
        expect(def('power').defaultThreshold).toBe(200)
    })
    it('traffic passes below the threshold only', () => {
        expect(def('traffic').passes(19, 20)).toBe(true)
        expect(def('traffic').passes(20, 20)).toBe(false)
    })
    it('acid fails only on high to moderate risk', () => {
        expect([0, 1, 2].map(v => def('acid').passes(v, 0))).toEqual([true, false, true])
    })
    it('are in table order', () => {
        expect(FILTERS.map(f => f.id)).toEqual(['bushfire', 'power', 'traffic', 'acid', 'noise'])
    })
})

describe('filterMask', () => {
    const d = data({bushfire: Uint8Array.from([0, 1, 0, 0]), power_m: Uint16Array.from([500, 500, 100, 300])})

    it('is null with no active filter', () => {
        expect(filterMask(d, {})).toBeNull()
    })
    it('ANDs active filters', () => {
        expect([...filterMask(d, {bushfire: 0, power: 200})!]).toEqual([1, 0, 0, 1])
    })
    it('ignores filters whose field is not loaded', () => {
        expect(availableFilters(d).map(f => f.id)).toEqual(['bushfire', 'power'])
        expect(filterMask(d, {acid: 0})).toBeNull()
        expect([...filterMask(d, {acid: 0, bushfire: 0})!]).toEqual([1, 0, 1, 1])
    })
})

describe('andMasks', () => {
    it('is null-aware and elementwise', () => {
        const m = Uint8Array.from([1, 0, 1])
        expect(andMasks(null, m)).toBe(m)
        expect(andMasks(m, null)).toBe(m)
        expect(andMasks(null, null)).toBeNull()
        expect([...andMasks(m, Uint8Array.from([1, 1, 0]))!]).toEqual([1, 0, 0])
    })
})
