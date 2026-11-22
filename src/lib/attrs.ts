/** Per-cell hazard and noise attributes. Format: data_gen/README.md (`attrs.bin`, `layers.json`). */
import {cellAt, fetchJson, dataUrl, gunzip, type GridMeta} from './grid'
import {LOCAL_LAYERS} from './local'

const MAGIC = 'PMA1'
const VERSION = 1

export type Plane = Uint8Array | Uint16Array

export interface LayerInfo {
    id: string
    field: string
    title: string
    source: string
    licence: string
    url: string
    asOf: string
    local: boolean
}

export interface AttrData {
    fields: Record<string, Plane>
    layers: LayerInfo[]
    /** off: public build; missing: local build without (readable) local files. */
    localStatus: 'off' | 'ok' | 'missing'
}

export async function decodeAttrs(body: ArrayBuffer, meta: GridMeta): Promise<Record<string, Plane>> {
    const buf = await gunzip(body)
    const view = new DataView(buf)
    const bytes = new Uint8Array(buf)
    const magic = String.fromCharCode(...bytes.subarray(0, 4))
    if (magic !== MAGIC || view.getUint16(4, true) !== VERSION) throw new Error('attrs format')
    if (view.getUint32(6, true) !== meta.width || view.getUint32(10, true) !== meta.height) throw new Error('attrs size')
    const count = view.getUint16(14, true)
    let off = 16
    const spec: [string, number][] = []
    for (let i = 0; i < count; i++) {
        const len = bytes[off]
        spec.push([String.fromCharCode(...bytes.subarray(off + 1, off + 1 + len)), bytes[off + 1 + len]])
        off += len + 2
    }
    off += off % 2
    const n = meta.width * meta.height
    const fields: Record<string, Plane> = {}
    for (const [name, type] of spec) {
        if (type !== 1 && type !== 2) throw new Error('attrs format')
        // copies: a u16 view needs an aligned offset, and planes must not alias the decompressed buffer
        const raw = buf.slice(off, off + n * type)
        if (raw.byteLength !== n * type) throw new Error('attrs size')
        fields[name] = type === 1 ? new Uint8Array(raw) : new Uint16Array(raw)
        off += n * type
    }
    return fields
}

async function loadPart(meta: GridMeta, prefix: string) {
    const [fields, manifest] = await Promise.all([
        fetch(dataUrl(`${prefix}attrs.bin`)).then(r => {
            if (!r.ok) throw new Error(`${prefix}attrs.bin: HTTP ${r.status}`)
            return r.arrayBuffer()
        }).then(b => decodeAttrs(b, meta)),
        fetchJson<{ layers: LayerInfo[] }>(`${prefix}layers.json`),
    ])
    return {fields, layers: manifest.layers}
}

const cache = new Map<boolean, Promise<AttrData>>()

/** Public attributes, plus the local ones in a local build. Loaded once; a failed load is forgotten. */
export function loadAttrs(meta: GridMeta, local = LOCAL_LAYERS): Promise<AttrData> {
    let p = cache.get(local)
    if (!p) {
        p = loadPart(meta, '').then(async pub => {
            if (!local) return {...pub, localStatus: 'off' as const}
            try {
                const loc = await loadPart(meta, 'local/')
                return {fields: {...pub.fields, ...loc.fields}, layers: [...pub.layers, ...loc.layers], localStatus: 'ok' as const}
            } catch (e) {
                console.warn('local layers not loaded', e)
                return {...pub, localStatus: 'missing' as const}
            }
        })
        p.catch(() => cache.delete(local))
        cache.set(local, p)
    }
    return p
}

export const clearAttrsCache = () => cache.clear()

/** Every field's value at a point; null outside the grid. */
export function attrsAt(data: AttrData, meta: GridMeta, lat: number, lng: number): Record<string, number> | null {
    const cell = cellAt(meta, lat, lng)
    if (cell === null) return null
    return Object.fromEntries(Object.entries(data.fields).map(([k, plane]) => [k, plane[cell]]))
}
