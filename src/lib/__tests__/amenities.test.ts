// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest'
import {AMENITY_COLOURS, clearAmenitiesCache, loadAmenities, parseAmenities} from '../amenities'

const JSON_BODY = {
    asOf: '2026-11-22', source: '© OpenStreetMap contributors, ODbL',
    types: [['supermarket', 'Supermarkets'], ['park', 'Parks']],
    items: [[0, -31.93, 115.81, 'Coles Wembley'], [1, -31.94, 115.82, ''], [0, -31.95, 115.83, 'IGA']],
}

afterEach(() => {
    vi.unstubAllGlobals()
    clearAmenitiesCache()
})

describe('parseAmenities', () => {
    it('groups places by type with counts', () => {
        const d = parseAmenities(JSON_BODY)
        expect(d.types.map(t => [t.id, t.label, t.count])).toEqual([['supermarket', 'Supermarkets', 2], ['park', 'Parks', 1]])
        expect(d.byType.supermarket.map(p => p.name)).toEqual(['Coles Wembley', 'IGA'])
        expect(d.byType.park[0]).toEqual({lat: -31.94, lng: 115.82, name: ''})
    })

    it('gives every type a colour', () => {
        for (const id of ['supermarket', 'park', 'playground', 'station', 'gp', 'pharmacy', 'hospital', 'childcare', 'library', 'cafe']) {
            expect(AMENITY_COLOURS[id]).toMatch(/^#[0-9a-f]{6}$/)
        }
    })
})

describe('loadAmenities', () => {
    it('fetches once and retries after a failure', async () => {
        const fail = vi.fn(async () => new Response('', {status: 404}))
        vi.stubGlobal('fetch', fail)
        await expect(loadAmenities()).rejects.toThrow()
        const ok = vi.fn(async () => new Response(JSON.stringify(JSON_BODY)))
        vi.stubGlobal('fetch', ok)
        expect((await loadAmenities()).types).toHaveLength(2)
        await loadAmenities()
        expect(ok).toHaveBeenCalledTimes(1)
    })
})
