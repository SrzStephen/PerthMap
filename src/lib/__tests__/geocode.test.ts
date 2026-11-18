// @vitest-environment node
import {describe, expect, it, vi} from 'vitest'
import {geocode, placeLabel} from '../geocode'

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), {status: 200}))

describe('geocode', () => {
    it('asks Nominatim within the mapped area only', async () => {
        const f = ok([])
        await geocode('12 Grantham St Wembley', {fetch: f})
        const url = new URL((f.mock.calls[0] as unknown as [string])[0])
        expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search')
        const p = Object.fromEntries(url.searchParams)
        expect(p).toEqual({
            format: 'jsonv2', q: '12 Grantham St Wembley', countrycodes: 'au',
            viewbox: '115.679169,-31.725200,116.060099,-32.301063', bounded: '1', limit: '5',
        })
    })

    it('maps results to places', async () => {
        const f = ok([{display_name: '12, Grantham Street, Wembley, Perth, Town of Cambridge, Western Australia, 6014, Australia', lat: '-31.93', lon: '115.81'}])
        expect(await geocode('x', {fetch: f})).toEqual([{label: '12, Grantham Street, Wembley, Perth, Town of Cambridge, Western Australia, 6014', lat: -31.93, lng: 115.81}])
    })

    it('throws on HTTP errors', async () => {
        const f = vi.fn(async () => new Response('', {status: 503}))
        await expect(geocode('x', {fetch: f})).rejects.toThrow('503')
    })
})

describe('placeLabel', () => {
    it('drops the country after the postcode', () => {
        expect(placeLabel('Wembley, Perth, Western Australia, 6014, Australia')).toBe('Wembley, Perth, Western Australia, 6014')
        expect(placeLabel('Kings Park, Perth')).toBe('Kings Park, Perth')
    })
})
