import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {RoutePanel} from '../RoutePanel'
import type {RouteResult, Routes, Stops} from '../../../lib/route'

const ROUTES: Routes = {
    samples: ['08:00'],
    lines: [['REGIONAL_RAIL', 'Joondalup Line', 'Elizabeth Quay Stn'], ['WALK', '', '']],
    shapes: [''],
    trips: {'1:0': [448, 480, [[0, 1, 2, 448, 471, 0, 0, 0], [1, 2, -1, 476, 480, 0, 0, 0]]]},
}
const STOPS: Stops = [['X', 0, 0], ['Warwick Stn Platform 2', -31.84, 115.81], ['Elizabeth Quay Stn', -31.95, 115.85]]
const TRANSIT: RouteResult = {kind: 'transit', best: 38, typical: 46, walk: 6, leave: '07:22', arrive: '08:00', boardStop: 1, trip: ROUTES.trips['1:0']}

const panel = (result: RouteResult, onClose = vi.fn()) => {
    render(<RoutePanel result={result} dayLabel="Weekday" routes={ROUTES} stops={STOPS} onClose={onClose}/>)
    return onClose
}

describe('RoutePanel', () => {
    it('shows times and one row per leg for a transit route', () => {
        panel(TRANSIT)
        expect(screen.getByText('Best 38 min · typical 46 min')).toBeInTheDocument()
        expect(screen.getByText('Leave 07:22 → arrive 08:00 (Weekday)')).toBeInTheDocument()
        const rows = screen.getAllByRole('listitem').map(li => li.textContent)
        expect(rows).toEqual([
            'Walk 6 min to Warwick Stn Platform 2',
            'Joondalup Line → Elizabeth Quay Stn07:28 – 07:51',
            'Walk 4 min to Perth CBD',
        ])
    })

    it('direct walk', () => {
        panel({kind: 'walk', best: 18, typical: 20})
        expect(screen.getByText('Best 18 min · typical 20 min')).toBeInTheDocument()
        expect(screen.getByText('Walk 18 min')).toBeInTheDocument()
    })

    it('missing trip', () => {
        panel({kind: 'missing', best: 38, typical: 46})
        expect(screen.getByText('Best 38 min · typical 46 min')).toBeInTheDocument()
        expect(screen.getByText('Route details unavailable')).toBeInTheDocument()
    })

    it('unreachable', () => {
        panel({kind: 'unreachable'})
        expect(screen.getByText('No public transport route within 2 h (max 15 min walk to a stop)')).toBeInTheDocument()
    })

    it('outside', () => {
        panel({kind: 'outside'})
        expect(screen.getByText('Outside the mapped area')).toBeInTheDocument()
    })

    it('closes with the ✕ button and with Escape', async () => {
        const onClose = panel(TRANSIT)
        await userEvent.click(screen.getByRole('button', {name: 'Close route'}))
        await userEvent.keyboard('{Escape}')
        expect(onClose).toHaveBeenCalledTimes(2)
    })
})
