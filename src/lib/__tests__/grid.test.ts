// @vitest-environment node
import {gzipSync} from 'node:zlib'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {DIRECT_WALK, NO_STOP, UNREACHABLE, cellAt, decodeGrid, evictGrid, loadGrid, windowKey, type DataIndex, type GridMeta} from '../grid'

const META: GridMeta = {width: 2, height: 2, minLon: 115, minLat: -32, spacing: 0.01}

function gridBytes({magic = 'PMG1', version = 1, width = 2, height = 2} = {}): ArrayBuffer {
    const n = width * height
    const buf = Buffer.alloc(14 + n * 6)
    buf.write(magic, 0, 'ascii')
    buf.writeUInt16LE(version, 4)
    buf.writeUInt32LE(width, 6)
    buf.writeUInt32LE(height, 10)
    let o = 14
    for (const plane of [[10, 20, 255, 40], [8, 18, 255, 38], [0, 1, 255, 11], [3, 4, 255, 9]]) {
        plane.slice(0, n).forEach((v, i) => buf.writeUInt8(v, o + i))
        o += n
    }
    ;[300, 0xfffe, 0xffff, 7].slice(0, n).forEach((v, i) => buf.writeUInt16LE(v, o + i * 2))
    const gz = gzipSync(buf)
    return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer
}

describe('decodeGrid', () => {
    it('decodes planes', async () => {
        const g = await decodeGrid(gridBytes(), META)
        expect([...g.median]).toEqual([10, 20, UNREACHABLE, 40])
        expect([...g.fastest]).toEqual([8, 18, 255, 38])
        expect([...g.sample]).toEqual([0, 1, 255, 11])
        expect([...g.walk]).toEqual([3, 4, 255, 9])
        expect([...g.stop]).toEqual([300, DIRECT_WALK, NO_STOP, 7])
        expect(g.meta).toBe(META)
    })

    it('rejects bad magic', async () => {
        await expect(decodeGrid(gridBytes({magic: 'XXXX'}), META)).rejects.toThrow('grid format')
        await expect(decodeGrid(gridBytes({version: 2}), META)).rejects.toThrow('grid format')
    })

    it('rejects size mismatch', async () => {
        await expect(decodeGrid(gridBytes({width: 1, height: 4}), META)).rejects.toThrow('grid size')
    })
})

describe('cellAt', () => {
    it('cellAt edges', () => {
        expect(cellAt(META, -32, 115)).toBe(0)
        expect(cellAt(META, -31.99, 115.01)).toBe(3)
        expect(cellAt(META, -31.99, 115)).toBe(2)
        expect(cellAt(META, -32, 115.02)).toBeNull()
        expect(cellAt(META, -32.01, 115)).toBeNull()
        expect(cellAt(META, -31.98, 115)).toBeNull()
        expect(cellAt(META, -32, 114.99)).toBeNull()
    })
})

describe('windowKey', () => {
    it('windowKey pads hour', () => {
        expect(windowKey('weekday', 8)).toBe('weekday-08')
        expect(windowKey('sunday', 21)).toBe('sunday-21')
    })
})

describe('loadGrid', () => {
    const index: DataIndex = {version: 1, generated: '', grid: META, days: [], hours: []}
    afterEach(() => {
        vi.unstubAllGlobals()
        evictGrid('weekday-08')
    })

    it('fetches the window file and caches it', async () => {
        const fetch = vi.fn<(url: string) => Promise<Response>>(async () => new Response(gridBytes()))
        vi.stubGlobal('fetch', fetch)
        const a = await loadGrid(index, 'weekday-08')
        const b = await loadGrid(index, 'weekday-08')
        expect(a).toBe(b)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(String(fetch.mock.calls[0][0])).toMatch(/data\/weekday-08\.grid\.bin\.gz$/)
    })

    it('failed load is evicted', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(new Response('nope', {status: 404}))
            .mockResolvedValueOnce(new Response(gridBytes()))
        vi.stubGlobal('fetch', fetch)
        await expect(loadGrid(index, 'weekday-08')).rejects.toThrow()
        await expect(loadGrid(index, 'weekday-08')).resolves.toBeTruthy()
    })
})
