// @vitest-environment node
import {gzipSync} from 'node:zlib'
import {describe, expect, it} from 'vitest'
import {bikeMinutes, bikeRideAt, decodeBike, pathGeometry, profile, type BikeGrid, type BikeRoutes} from '../bike'
import {NO_STOP, UNREACHABLE, type GridMeta} from '../grid'

const META: GridMeta = {width: 3, height: 1, minLon: 115, minLat: -32, spacing: 0.01}
const NA = 0xffff

function bikeBytes({magic = 'PMB1', version = 1, width = 3, height = 1, seconds = [900, NA, 60000], path = [0, 0, NA]} = {}): ArrayBuffer {
    const n = width * height
    const buf = Buffer.alloc(14 + n * 4)
    buf.write(magic, 0, 'ascii')
    buf.writeUInt16LE(version, 4)
    buf.writeUInt32LE(width, 6)
    buf.writeUInt32LE(height, 10)
    seconds.slice(0, n).forEach((v, i) => buf.writeUInt16LE(v, 14 + i * 2))
    path.slice(0, n).forEach((v, i) => buf.writeUInt16LE(v, 14 + 2 * n + i * 2))
    const gz = gzipSync(buf)
    return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer
}

const bike = (seconds: number[], path: number[], meta = META): BikeGrid =>
    ({meta, seconds: Uint16Array.from(seconds), path: Uint16Array.from(path)})

// "_ibE_ibE?_ibE" style shapes are awkward to hand-write; encode with the same algorithm as the pipeline
function encode(points: [number, number][]): string {
    let out = '', pLat = 0, pLng = 0
    const enc = (v: number) => {
        let x = v < 0 ? ~(v << 1) : v << 1, s = ''
        while (x >= 0x20) {
            s += String.fromCharCode((0x20 | (x & 0x1f)) + 63)
            x >>= 5
        }
        return s + String.fromCharCode(x + 63)
    }
    for (const [lat, lng] of points) {
        const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5)
        out += enc(a - pLat) + enc(b - pLng)
        pLat = a
        pLng = b
    }
    return out
}

const ROUTES: BikeRoutes = {
    refSpeedKmh: 15,
    shapes: [encode([[-32, 115], [-32, 115.001]]), encode([[-32, 115.001], [-31.999, 115.001]])],
    lengths: [100, 40],
    elev: [[10, 2, 2], [14, -4]],
    paths: [[900, 3750, 4, 4, [0, 1]]],
}

describe('decodeBike', () => {
    it('reads both planes', async () => {
        const b = await decodeBike(bikeBytes(), META)
        expect([...b.seconds]).toEqual([900, NA, 60000])
        expect([...b.path]).toEqual([0, 0, NA])
    })
    it('rejects another format', async () => {
        await expect(decodeBike(bikeBytes({magic: 'PMG1'}), META)).rejects.toThrow('bike format')
    })
    it('rejects another size', async () => {
        await expect(decodeBike(bikeBytes({width: 2}), META)).rejects.toThrow('bike size')
    })
})

describe('bikeMinutes', () => {
    const b = bike([900, NA, 60000], [0, 0, NA])
    it('scales seconds at the reference speed to minutes at any speed', () => {
        expect(bikeMinutes(b, 15, 15).median[0]).toBe(15)
        expect(bikeMinutes(b, 25, 15).median[0]).toBe(9)
        expect(bikeMinutes(b, 12, 15).median[0]).toBe(19) // 18.75
    })
    it('keeps unreachable and clamps long rides below the sentinel', () => {
        const g = bikeMinutes(b, 12, 15)
        expect(g.median[1]).toBe(UNREACHABLE)
        expect(g.median[2]).toBe(254)
        expect(g.fastest).toEqual(g.median)
        expect(g.stop[0]).toBe(NO_STOP)
    })
})

describe('profile', () => {
    it('joins segments without repeating the joint', () => {
        expect(profile(ROUTES.paths[0], ROUTES)).toEqual([[0, 10], [50, 12], [100, 14], [140, 10]])
    })
    it('is null when a segment has no elevation', () => {
        expect(profile(ROUTES.paths[0], {...ROUTES, elev: [[10, 2, 2], null]})).toBeNull()
    })
})

describe('pathGeometry', () => {
    it('concatenates shapes without repeating the joint', () => {
        expect(pathGeometry(ROUTES.paths[0], ROUTES)).toEqual([[-32, 115], [-32, 115.001], [-31.999, 115.001]])
    })
})

describe('bikeRideAt', () => {
    const at = (b: BikeGrid, routes: BikeRoutes | null, lng: number, speed = 15) =>
        bikeRideAt(bikeMinutes(b, speed, 15), b, routes, -32, lng, speed, 15)

    it('outside the grid', () => {
        expect(at(bike([900, 900, 900], [0, 0, 0]), ROUTES, 114)).toEqual({kind: 'outside'})
    })
    it('unreachable with no reachable cell nearby', () => {
        expect(at(bike([NA, NA, NA], [NA, NA, NA]), ROUTES, 115.01).kind).toBe('unreachable')
    })
    it('snaps an unreachable cell to a reachable neighbour', () => {
        const r = at(bike([NA, 900, NA], [0, 0, 0]), ROUTES, 115)
        expect(r).toMatchObject({kind: 'ride', minutes: 15, metres: 3750})
    })
    it('ride: own cell time and distance, path geometry and profile', () => {
        const r = at(bike([600, 900, 900], [0, 0, 0]), ROUTES, 115, 20)
        expect(r).toMatchObject({kind: 'ride', minutes: 8, metres: 2500, speed: 20, ascent: 4, descent: 4})
        if (r.kind !== 'ride') throw new Error()
        expect(r.geometry).toHaveLength(3)
        expect(r.profile).toHaveLength(4)
    })
    it('missing without a path or route data', () => {
        expect(at(bike([600, 900, 900], [NA, 0, 0]), ROUTES, 115)).toEqual({kind: 'missing', minutes: 10, metres: 2500, speed: 15})
        expect(at(bike([600, 900, 900], [0, 0, 0]), null, 115)).toMatchObject({kind: 'missing'})
    })
})
