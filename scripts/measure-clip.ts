// Times contouring with and without water clipping on a real window:
//   npx vite-node scripts/measure-clip.ts public/data/weekday-08.grid.bin.gz public/data/water.json public/data/index.json
import {readFileSync} from 'node:fs'
import {THRESHOLDS} from '../src/lib/bands'
import {buildBands, waterFromGeoJSON} from '../src/lib/contours'
import {decodeGrid, type DataIndex} from '../src/lib/grid'

const [gridPath, waterPath, indexPath] = process.argv.slice(2)
const index = JSON.parse(readFileSync(indexPath, 'utf8')) as DataIndex
const buf = readFileSync(gridPath)
const grid = await decodeGrid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, index.grid)
const water = waterFromGeoJSON(JSON.parse(readFileSync(waterPath, 'utf8')))
    .map(poly => poly.filter(ring => ring.length >= 4))
    .filter(poly => poly.length > 0)
console.log(`water: ${water.length} polygons, ${water.flat(2).length} vertices`)

function time(label: string, fn: () => unknown) {
    fn() // warm up
    const t0 = performance.now()
    const runs = 3
    for (let i = 0; i < runs; i++) fn()
    console.log(`${label}: ${((performance.now() - t0) / runs).toFixed(0)} ms`)
}

time('contour only', () => buildBands(grid, THRESHOLDS, null))
time('contour + water clip', () => buildBands(grid, THRESHOLDS, water))
