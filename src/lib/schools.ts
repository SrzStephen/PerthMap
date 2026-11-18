/** Public schools and their local intake areas. Format: data_gen/README.md (`schools.json`, `intake.json`, `intake.bin`). */
import {cellAt, dataUrl, fetchJson, gunzip, type GridMeta} from './grid'

export const NO_SCHOOL = 0xffff
const MAGIC = 'PMI1'
const VERSION = 1
const HEADER = 14

export interface School {
    index: number
    code: string
    name: string
    primary: boolean
    secondary: boolean
    lat: number
    lon: number
    /** Whether an intake area was extracted for it. */
    hasIntake: boolean
}

export interface IntakeFeature {
    i: number
    kind: 'main' | 'optional'
    /** Leaflet order: polygons → rings → [lat, lng]. */
    positions: [number, number][][][]
}

export interface IntakeGrid {
    primary: Uint16Array
    secondary: Uint16Array
}

export interface SchoolData {
    asOf: string
    source: string
    schools: School[]
    areas: IntakeFeature[]
    intake: IntakeGrid
}

export type SchoolRow = [string, string, string, number, number, boolean]

interface SchoolsJson {
    asOf: string
    source: string
    schools: SchoolRow[] | unknown[][]
}

interface IntakeJson {
    features: { properties: { i: number; kind: string }; geometry: { type: string; coordinates: unknown } | null }[]
}

const flip = (ring: number[][]) => ring.map(([lng, lat]) => [lat, lng] as [number, number])

/** Schools and intake polygons from their JSON files. */
export function parseSchools(sj: SchoolsJson, ij: IntakeJson): Omit<SchoolData, 'intake'> {
    const schools = (sj.schools as SchoolRow[]).map(([code, name, levels, lat, lon, hasIntake], index) => ({
        index, code, name, primary: levels.includes('P'), secondary: levels.includes('S'), lat, lon, hasIntake,
    }))
    const areas: IntakeFeature[] = []
    for (const f of ij.features) {
        const g = f.geometry
        if (!g) continue
        const polys = g.type === 'Polygon' ? [g.coordinates as number[][][]]
            : g.type === 'MultiPolygon' ? g.coordinates as number[][][][] : []
        if (!polys.length) continue
        areas.push({i: f.properties.i, kind: f.properties.kind === 'optional' ? 'optional' : 'main',
            positions: polys.map(p => p.map(flip))})
    }
    return {asOf: sj.asOf, source: sj.source, schools, areas}
}

export async function decodeIntake(body: ArrayBuffer, meta: GridMeta): Promise<IntakeGrid> {
    const buf = await gunzip(body)
    const view = new DataView(buf)
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4))
    if (magic !== MAGIC || view.getUint16(4, true) !== VERSION) throw new Error('intake format')
    if (view.getUint32(6, true) !== meta.width || view.getUint32(10, true) !== meta.height) throw new Error('intake size')
    const n = meta.width * meta.height
    // copy: the u16 planes start at an even but otherwise arbitrary offset, and must not alias a shared buffer
    const planes = new Uint16Array(buf.slice(HEADER, HEADER + 4 * n))
    return {primary: planes.slice(0, n), secondary: planes.slice(n)}
}

let cache: Promise<SchoolData> | null = null

/** Loaded once; a failed load is forgotten so it can be retried. */
export function loadSchoolData(meta: GridMeta): Promise<SchoolData> {
    if (!cache) {
        cache = Promise.all([
            fetchJson<SchoolsJson>('schools.json'),
            fetchJson<IntakeJson>('intake.json'),
            fetch(dataUrl('intake.bin')).then(r => {
                if (!r.ok) throw new Error(`intake.bin: HTTP ${r.status}`)
                return r.arrayBuffer()
            }).then(b => decodeIntake(b, meta)),
        ]).then(([sj, ij, intake]) => ({...parseSchools(sj, ij), intake}))
        cache.catch(() => (cache = null))
    }
    return cache
}

export interface IntakeSchools {
    primary: School | null
    secondary: School | null
}

/** Schools whose main intake area holds the point's cell; null outside the grid. */
export function intakeAt(data: SchoolData, meta: GridMeta, lat: number, lng: number): IntakeSchools | null {
    const cell = cellAt(meta, lat, lng)
    if (cell === null) return null
    const pick = (i: number) => (i === NO_SCHOOL ? null : data.schools[i] ?? null)
    return {primary: pick(data.intake.primary[cell]), secondary: pick(data.intake.secondary[cell])}
}

/** 1 for cells inside any selected school's main area; null when nothing is selected. */
export function intakeMask(data: SchoolData, selected: number[]): Uint8Array | null {
    if (!selected.length) return null
    const want = new Set(selected)
    const {primary, secondary} = data.intake
    const mask = new Uint8Array(primary.length)
    for (let i = 0; i < mask.length; i++) if (want.has(primary[i]) || want.has(secondary[i])) mask[i] = 1
    return mask
}
