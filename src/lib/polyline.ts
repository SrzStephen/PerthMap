/** Google encoded polyline → [lat, lng] points. */
export function decodePolyline(s: string, precision: number): [number, number][] {
    const f = 10 ** precision
    const pts: [number, number][] = []
    let i = 0, lat = 0, lng = 0
    const next = () => {
        let shift = 0, result = 0, b: number
        do {
            b = s.charCodeAt(i++) - 63
            result |= (b & 0x1f) << shift
            shift += 5
        } while (b >= 0x20)
        return result & 1 ? ~(result >> 1) : result >> 1
    }
    while (i < s.length) {
        lat += next()
        lng += next()
        pts.push([lat / f, lng / f])
    }
    return pts
}
