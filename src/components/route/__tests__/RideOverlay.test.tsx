import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import {RideOverlay} from '../RideOverlay'
import {MODE_COLORS} from '../../../lib/route'
import type {RideResult} from '../../../lib/bike'

const map = vi.hoisted(() => ({contains: true, fitBounds: vi.fn()}))

vi.mock('react-leaflet', () => ({
    Polyline: ({positions, pathOptions}: { positions: unknown[]; pathOptions: { color: string; dashArray?: string } }) =>
        <div data-testid="line" data-color={pathOptions.color} data-dash={pathOptions.dashArray ?? ''} data-n={positions.length}/>,
    CircleMarker: () => <div data-testid="dot"/>,
    useMap: () => ({getBounds: () => ({contains: () => map.contains}), fitBounds: map.fitBounds}),
}))

const RIDE: RideResult = {
    kind: 'ride', minutes: 34, metres: 11240, speed: 15, geometry: [[-32, 115.8], [-31.99, 115.81], [-31.95, 115.86]],
    profile: null, ascent: null, descent: null,
}

describe('RideOverlay', () => {
    it('draws a dashed connector and the ride path', () => {
        render(<RideOverlay point={[-32.001, 115.8]} result={RIDE}/>)
        const lines = screen.getAllByTestId('line').map(l => ({color: l.dataset.color, dashed: l.dataset.dash !== '', n: l.dataset.n}))
        expect(lines).toEqual([
            {color: MODE_COLORS.WALK, dashed: true, n: '2'},
            {color: MODE_COLORS.BIKE, dashed: false, n: '3'},
        ])
        expect(screen.getByTestId('dot')).toBeInTheDocument()
    })

    it('fits the map when the path is off screen', () => {
        map.contains = false
        render(<RideOverlay point={[-32.001, 115.8]} result={RIDE}/>)
        expect(map.fitBounds).toHaveBeenCalled()
        map.contains = true
    })

    it('draws nothing for outside or unreachable', () => {
        const {rerender} = render(<RideOverlay point={[0, 0]} result={{kind: 'outside'}}/>)
        expect(screen.queryAllByTestId('line')).toHaveLength(0)
        rerender(<RideOverlay point={[0, 0]} result={{kind: 'unreachable'}}/>)
        expect(screen.queryAllByTestId('line')).toHaveLength(0)
    })

    it('marks the point but draws no path when it is missing', () => {
        render(<RideOverlay point={[0, 0]} result={{kind: 'missing', minutes: 1, metres: 1, speed: 15}}/>)
        expect(screen.queryAllByTestId('line')).toHaveLength(0)
        expect(screen.getByTestId('dot')).toBeInTheDocument()
    })
})
