/// <reference lib="webworker" />
import {buildBands, type LngLatMultiPolygon} from './contours'
import type {Grid} from './grid'

export interface BandsRequest {
    id: number
    grid: Grid
    thresholds: number[]
    water: LngLatMultiPolygon | null
}

self.onmessage = (e: MessageEvent<BandsRequest>) => {
    const {id, grid, thresholds, water} = e.data
    try {
        self.postMessage({id, bands: buildBands(grid, thresholds, water)})
    } catch (err) {
        self.postMessage({id, error: String(err)})
    }
}
