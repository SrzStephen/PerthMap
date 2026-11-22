// @vitest-environment node
import {gzipSync} from 'node:zlib'
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {GridMeta} from '../grid'
import {attrsAt, clearAttrsCache, decodeAttrs, loadAttrs} from '../attrs'

const META: GridMeta = {width: 2, height: 2, minLon: 115, minLat: -32, spacing: 0.01}

/** PMA1 with a u8 field `fire` and a u16 field `power_m` (odd-length names force the pad byte). */
export function attrsBytes({magic = 'PMA1', width = 2, height = 2,
                               fields = [['fire', 1, [0, 1, 1, 0]], ['power_m', 2, [10, 300, 5000, 0]]] as [string, number, number[]][]} = {}) {
    const n = width * height
    const head: number[] = [...Buffer.from(magic, 'ascii')]
    const u16 = (v: number) => [v & 0xff, v >> 8]
    const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24]
    head.push(...u16(1), ...u32(width), ...u32(height), ...u16(fields.length))
    for (const [name, type] of fields) head.push(name.length, ...Buffer.from(name, 'ascii'), type)
    if (head.length % 2) head.push(0)
    const body: number[] = []
    for (const [, type, values] of fields) for (const v of values.slice(0, n)) body.push(...(type === 1 ? [v] : u16(v)))
    return Buffer.from([...head, ...body])
}

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

const LAYERS = {layers: [{id: 'bushfire', field: 'fire', title: 'Bushfire prone areas', source: 'OBRM-026',
    licence: 'CC BY 4.0', url: 'u', asOf: '2026-11-22', local: false}]}
const LOCAL_LAYERS = {layers: [{id: 'acid', field: 'acid', title: 'Acid sulfate soils', source: 'DWER-055',
    licence: 'Personal use only', url: 'u', asOf: '2026-11-22', local: true}]}

function mockFetch(files: Record<string, Buffer | object>) {
    const fn = vi.fn(async (url: string) => {
        const name = url.replace(/^.*\/data\//, '')
        const body = files[name]
        if (!body) return new Response('nope', {status: 404})
        return new Response(Buffer.isBuffer(body) ? ab(body) : JSON.stringify(body))
    })
    vi.stubGlobal('fetch', fn)
    return fn
}

afterEach(() => {
    vi.unstubAllGlobals()
    clearAttrsCache()
})

describe('decodeAttrs', () => {
    it('decodes u8 and u16 planes, gzipped or not', async () => {
        for (const body of [gzipSync(attrsBytes()), attrsBytes()]) {
            const f = await decodeAttrs(ab(body), META)
            expect(f.fire).toBeInstanceOf(Uint8Array)
            expect([...f.fire]).toEqual([0, 1, 1, 0])
            expect(f.power_m).toBeInstanceOf(Uint16Array)
            expect([...f.power_m]).toEqual([10, 300, 5000, 0])
        }
    })
    it('rejects a wrong magic', async () => {
        await expect(decodeAttrs(ab(attrsBytes({magic: 'PMX1'})), META)).rejects.toThrow('attrs format')
    })
    it('rejects a grid of another size', async () => {
        await expect(decodeAttrs(ab(attrsBytes({width: 3})), META)).rejects.toThrow('attrs size')
    })
})

describe('loadAttrs', () => {
    it('keeps public fields when the local files are missing', async () => {
        mockFetch({'attrs.bin': gzipSync(attrsBytes()), 'layers.json': LAYERS})
        const d = await loadAttrs(META, true)
        expect(d.localStatus).toBe('missing')
        expect(Object.keys(d.fields).sort()).toEqual(['fire', 'power_m'])
        expect(d.layers.map(l => l.id)).toEqual(['bushfire'])
    })
    it('merges local fields and layers', async () => {
        mockFetch({'attrs.bin': attrsBytes(), 'layers.json': LAYERS,
            'local/attrs.bin': attrsBytes({fields: [['acid', 1, [1, 2, 0, 0]]]}), 'local/layers.json': LOCAL_LAYERS})
        const d = await loadAttrs(META, true)
        expect(d.localStatus).toBe('ok')
        expect([...d.fields.acid]).toEqual([1, 2, 0, 0])
        expect(d.layers.map(l => l.id)).toEqual(['bushfire', 'acid'])
    })
    it('never asks for local files in a public build', async () => {
        const fn = mockFetch({'attrs.bin': attrsBytes(), 'layers.json': LAYERS})
        const d = await loadAttrs(META, false)
        expect(d.localStatus).toBe('off')
        expect(fn.mock.calls.some(([u]) => String(u).includes('local/'))).toBe(false)
    })
    it('rejects without public data and retries on the next call', async () => {
        const fn = mockFetch({'layers.json': LAYERS})
        await expect(loadAttrs(META, false)).rejects.toThrow()
        const before = fn.mock.calls.length
        await expect(loadAttrs(META, false)).rejects.toThrow()
        expect(fn.mock.calls.length).toBeGreaterThan(before)
    })
})

describe('attrsAt', () => {
    it('reads every field at a point; null outside the grid', async () => {
        mockFetch({'attrs.bin': attrsBytes(), 'layers.json': LAYERS})
        const d = await loadAttrs(META, false)
        expect(attrsAt(d, META, -32, 115.01)).toEqual({fire: 1, power_m: 300})
        expect(attrsAt(d, META, -33, 115)).toBeNull()
    })
})
