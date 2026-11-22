import {describe, expect, it} from 'vitest'
import {decodePolyline} from '../polyline'

describe('decodePolyline', () => {
    it('decodes the reference precision-5 example', () => {
        const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)
        expect(pts).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])
    })

    it('decodes MOTIS precision-6 leg geometry', () => {
        // first vertices of the Joondalup Stn rail leg in data_gen/tests/fixtures/plan_joondalup.json
        const [first] = decodePolyline('~upp{@yl{x{E@_A', 6)
        expect(first[0]).toBeCloseTo(-31.744880, 5)
        expect(first[1]).toBeCloseTo(115.767517, 5)
    })

    it('returns no points for an empty string', () => {
        expect(decodePolyline('', 5)).toEqual([])
    })
})
