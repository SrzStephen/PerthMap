import poly from '../assets/poly.json'
import {parseBands} from './bands'

/** Bands from the bundled GeoJSON, largest time first. */
export const BANDS = parseBands(poly)

/** Band times present in the data, ascending. */
export const BAND_TIMES = BANDS.map(b => b.time).reverse()
