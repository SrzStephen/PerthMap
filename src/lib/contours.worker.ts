/// <reference lib="webworker" />
import {buildBands, type LngLatMultiPolygon} from './contours'
import type {Grid} from './grid'

export interface BandsRequest {
    id: number
    grid: Grid
    thresholds: number[]
    water: LngLatMultiPolygon | null
    /** 1 = keep; cells at 0 are drawn as unreachable (outside the chosen intake areas). */
    mask: Uint8Array | null
}

self.onmessage = (e: MessageEvent<BandsRequest>) => {
    const {id, grid, thresholds, water, mask} = e.data
    try {
        self.postMessage({id, bands: buildBands(grid, thresholds, water, mask)})
    } catch (err) {
        self.postMessage({id, error: String(err)})
    }
}
