// @vitest-environment node
import {gunzipSync, gzipSync} from 'node:zlib'
import {describe, expect, it} from 'vitest'
import type {GridMeta} from '../grid'
import {NO_SCHOOL, decodeIntake, intakeAt, intakeMask, parseSchools, type SchoolData} from '../schools'

const META: GridMeta = {width: 2, height: 2, minLon: 115, minLat: -32, spacing: 0.01}

function intakeBytes({magic = 'PMI1', width = 2, height = 2, primary = [0, 0, 1, NO_SCHOOL], secondary = [2, NO_SCHOOL, 2, NO_SCHOOL]} = {}) {
    const n = width * height
    const buf = Buffer.alloc(14 + n * 4)
    buf.write(magic, 0, 'ascii')
    buf.writeUInt16LE(1, 4)
    buf.writeUInt32LE(width, 6)
    buf.writeUInt32LE(height, 10)
    primary.slice(0, n).forEach((v, i) => buf.writeUInt16LE(v, 14 + i * 2))
    secondary.slice(0, n).forEach((v, i) => buf.writeUInt16LE(v, 14 + n * 2 + i * 2))
    return buf
}

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

const SCHOOLS_JSON = {
    asOf: '2026-11-19',
    source: 'DoE',
    schools: [
        ['5464', 'Wembley Primary School', 'P', -32, 115, true],
        ['5102', 'Churchlands Primary School', 'P', -31.99, 115, true],
        ['4012', 'Churchlands Senior High School', 'S', -31.99, 115.01, true],
        ['9999', 'Sir David Brand School', 'PS', -31.99, 115.01, false],
    ],
}
const INTAKE_JSON = {
    type: 'FeatureCollection',
    features: [{type: 'Feature', properties: {i: 0, kind: 'main'}, geometry: {type: 'Polygon', coordinates: [[[115, -32], [115.01, -32], [115, -31.99], [115, -32]]]}}],
}

async function data(): Promise<SchoolData> {
    const intake = await decodeIntake(ab(gzipSync(intakeBytes())), META)
    return {...parseSchools(SCHOOLS_JSON, INTAKE_JSON), intake}
}

describe('decodeIntake', () => {
    it('decodes gzipped and already-decompressed bodies', async () => {
        const gz = await decodeIntake(ab(gzipSync(intakeBytes())), META)
        expect([...gz.primary]).toEqual([0, 0, 1, NO_SCHOOL])
        expect([...gz.secondary]).toEqual([2, NO_SCHOOL, 2, NO_SCHOOL])
        const raw = await decodeIntake(ab(gunzipSync(gzipSync(intakeBytes()))), META)
        expect([...raw.primary]).toEqual([0, 0, 1, NO_SCHOOL])
    })

    it('rejects bad magic and size mismatch', async () => {
        await expect(decodeIntake(ab(intakeBytes({magic: 'XXXX'})), META)).rejects.toThrow('intake format')
        await expect(decodeIntake(ab(intakeBytes({width: 1, height: 4})), META)).rejects.toThrow('intake size')
    })
})

describe('parseSchools', () => {
    it('maps rows and flips GeoJSON to lat,lng', () => {
        const {schools, areas, asOf} = parseSchools(SCHOOLS_JSON, INTAKE_JSON)
        expect(asOf).toBe('2026-11-19')
        expect(schools[3]).toEqual({index: 3, code: '9999', name: 'Sir David Brand School', primary: true, secondary: true, lat: -31.99, lon: 115.01, hasIntake: false})
        expect(areas[0]).toEqual({i: 0, kind: 'main', positions: [[[[-32, 115], [-32, 115.01], [-31.99, 115], [-32, 115]]]]})
    })
})

describe('intakeAt', () => {
    it('returns the schools whose main areas hold the cell', async () => {
        const d = await data()
        expect(intakeAt(d, META, -32, 115)).toEqual({primary: d.schools[0], secondary: d.schools[2]})
        expect(intakeAt(d, META, -32, 115.01)).toEqual({primary: d.schools[0], secondary: null})
        expect(intakeAt(d, META, -31.99, 115.01)).toEqual({primary: null, secondary: null})
    })

    it('is null outside the grid', async () => {
        expect(intakeAt(await data(), META, -33, 115)).toBeNull()
    })
})

describe('intakeMask', () => {
    it('is null with nothing selected', async () => {
        expect(intakeMask(await data(), [])).toBeNull()
    })

    it('marks cells in any selected school', async () => {
        const d = await data()
        expect([...intakeMask(d, [2])!]).toEqual([1, 0, 1, 0])
        expect([...intakeMask(d, [1, 2])!]).toEqual([1, 0, 1, 0])
        expect([...intakeMask(d, [0])!]).toEqual([1, 1, 0, 0])
    })
})
