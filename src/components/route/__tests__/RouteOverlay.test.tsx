import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import type {ReactNode} from 'react'
import {RouteOverlay} from '../RouteOverlay'
import {MODE_COLORS} from '../../../lib/route'
import type {RouteResult, Routes, Stops} from '../../../lib/route'

const map = vi.hoisted(() => ({contains: true, fitBounds: vi.fn()}))

vi.mock('react-leaflet', () => ({
    Polyline: ({positions, pathOptions}: { positions: unknown[]; pathOptions: { color: string; dashArray?: string } }) =>
        <div data-testid="line" data-color={pathOptions.color} data-dash={pathOptions.dashArray ?? ''} data-n={positions.length}/>,
    CircleMarker: ({children}: { children?: ReactNode }) => <div data-testid="dot">{children}</div>,
    useMap: () => ({getBounds: () => ({contains: () => map.contains}), fitBounds: map.fitBounds}),
}))

// shape 0 = 3 points
const ROUTES: Routes = {
    samples: ['08:00'],
    lines: [['BUS', '950', 'UWA'], ['WALK', '', ''], ['REGIONAL_RAIL', 'Yanchep Line', 'Elizabeth Quay Stn']],
    shapes: ['_p~iF~ps|U_ulLnnqC_mqNvxq`@'],
    trips: {'1:0': [448, 480, [[0, 1, 2, 448, 460, 0, 0, 1], [2, 2, 3, 462, 470, 0, 1, 2], [1, 3, -1, 470, 480, 0, 1, 2]]]},
}
const STOPS: Stops = [['X', 0, 0], ['Board', 38.5, -120.2], ['Mid', 40.7, -120.95], ['Alight', 43.25, -126.45]]
const TRANSIT: RouteResult = {kind: 'transit', best: 38, typical: 46, walk: 6, leave: '07:22', arrive: '08:00', boardStop: 1, trip: ROUTES.trips['1:0']}
const lines = () => screen.queryAllByTestId('line').map(l => ({color: l.dataset.color, dashed: l.dataset.dash !== ''}))

describe('RouteOverlay', () => {
    it('draws a dashed walk to the stop and each leg coloured by mode', () => {
        render(<RouteOverlay point={[38.4, -120.1]} result={TRANSIT} routes={ROUTES} stops={STOPS}/>)
        expect(lines()).toEqual([
            {color: MODE_COLORS.WALK, dashed: true},
            {color: MODE_COLORS.BUS, dashed: false},
            {color: MODE_COLORS.TRAIN, dashed: false},
            {color: MODE_COLORS.WALK, dashed: true},
        ])
    })

    it('marks the clicked point and each board/alight stop', () => {
        render(<RouteOverlay point={[38.4, -120.1]} result={TRANSIT} routes={ROUTES} stops={STOPS}/>)
        // pin + 2 transit legs × (board, alight)
        expect(screen.getAllByTestId('dot')).toHaveLength(5)
    })

    it('draws nothing outside or for unreachable points', () => {
        render(<RouteOverlay point={[0, 0]} result={{kind: 'outside'}} routes={ROUTES} stops={STOPS}/>)
        render(<RouteOverlay point={[0, 0]} result={{kind: 'unreachable'}} routes={ROUTES} stops={STOPS}/>)
        expect(lines()).toEqual([])
        expect(screen.queryAllByTestId('dot')).toEqual([])
    })

    it('pans only when the route is partly off screen', () => {
        map.contains = true
        const {unmount} = render(<RouteOverlay point={[38.4, -120.1]} result={TRANSIT} routes={ROUTES} stops={STOPS}/>)
        expect(map.fitBounds).not.toHaveBeenCalled()
        unmount()
        map.contains = false
        render(<RouteOverlay point={[38.4, -120.1]} result={TRANSIT} routes={ROUTES} stops={STOPS}/>)
        expect(map.fitBounds).toHaveBeenCalledTimes(1)
    })
})
