import {contours} from 'd3-contour'
import * as polyclip from 'polyclip-ts'
import type {Band} from './bands'
import {UNREACHABLE, type Grid} from './grid'

/** GeoJSON-order ([lng, lat]) multipolygon. */
export type LngLatMultiPolygon = number[][][][]

/**
 * Clip bands to land. Off: scripts/measure-clip.ts measured 12.1 s per window (polyclip-ts against ~1.9k OSM water
 * polygons) vs 523 ms for contouring alone. Water cells are already unreachable in the grid, so band edges stay
 * within ~half a cell (~50 m) of the shore without it.
 */
export const CLIP_WATER = false

const FAR = 1e4

/**
 * Bands "median < t" for each threshold, largest time first, empty bands omitted.
 * d3-contour encloses `value >= level`, so the negated plane is contoured at -(t - 0.5):
 * minutes are integers, so that is exactly `median < t`.
 */
export function buildBands(grid: Grid, thresholds: number[], water: LngLatMultiPolygon | null,
                           mask: Uint8Array | null = null): Band[] {
    const {width, height, minLon, minLat, spacing} = grid.meta
    const values = new Float64Array(width * height)
    for (let i = 0; i < values.length; i++) {
        values[i] = grid.median[i] === UNREACHABLE || (mask && !mask[i]) ? -FAR : -grid.median[i]
    }
    const gen = contours().size([width, height])
    // d3-contour puts cell i's centre at i + 0.5
    const toLngLat = ([x, y]: number[]) => [minLon + (x - 0.5) * spacing, minLat + (y - 0.5) * spacing]

    const bands: Band[] = []
    for (const t of [...thresholds].sort((a, b) => b - a)) {
        const shape = gen.contour(Array.from(values), -(t - 0.5))
        let mp: LngLatMultiPolygon = shape.coordinates.map(poly => poly.map(ring => ring.map(toLngLat)))
        if (!mp.length) continue
        if (water?.length) mp = polyclip.difference(mp as polyclip.Geom, water as polyclip.Geom) as LngLatMultiPolygon
        if (!mp.length) continue
        bands.push({time: t, positions: mp.map(poly => poly.map(ring => ring.map(([lng, lat]) => [lat, lng] as [number, number])))})
    }
    return bands
}

interface GeoJSONLike {
    features: { geometry: { type: string; coordinates: unknown } | null; [key: string]: unknown }[]
    [key: string]: unknown
}

/** Polygons and multipolygons of a FeatureCollection as one multipolygon. */
export function waterFromGeoJSON(fc: GeoJSONLike): LngLatMultiPolygon {
    const out: LngLatMultiPolygon = []
    for (const f of fc.features) {
        if (f.geometry?.type === 'Polygon') out.push(f.geometry.coordinates as number[][][])
        else if (f.geometry?.type === 'MultiPolygon') out.push(...(f.geometry.coordinates as number[][][][]))
    }
    return out
}
