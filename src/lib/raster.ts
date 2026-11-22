/** Attribute planes painted as images over the grid (one pixel per cell). */
import type {Plane} from './attrs'
import type {GridMeta} from './grid'

export type RGBA = [number, number, number, number]

/** RGBA pixels, width × height; image row 0 is the grid's north row. */
export function rasterPixels(values: Plane, meta: GridMeta, colour: (v: number) => RGBA | null): Uint8ClampedArray {
    const {width, height} = meta
    const px = new Uint8ClampedArray(width * height * 4)
    for (let iy = 0; iy < height; iy++) {
        const row = height - 1 - iy
        for (let ix = 0; ix < width; ix++) {
            const c = colour(values[iy * width + ix])
            if (c) px.set(c, (row * width + ix) * 4)
        }
    }
    return px
}

/** Leaflet bounds [[south, west], [north, east]] of the cells (centres ± half a cell). */
export function rasterBounds(meta: GridMeta): [[number, number], [number, number]] {
    const {width, height, minLon, minLat, spacing: s} = meta
    return [[minLat - s / 2, minLon - s / 2], [minLat + (height - 0.5) * s, minLon + (width - 0.5) * s]]
}

/** Raster layer id → cell colour. */
export const LAYER_STYLES: Record<string, (v: number) => RGBA | null> = {
    bushfire: v => (v ? [234, 88, 12, 110] : null),
    acid: v => (v === 1 ? [161, 98, 7, 120] : v === 2 ? [161, 98, 7, 60] : null),
    noise: v => (v ? [124, 58, 237, 100] : null),
}
