import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {RidePanel} from '../RidePanel'
import {ElevationProfile} from '../ElevationProfile'
import type {RideResult} from '../../../lib/bike'

const RIDE: RideResult = {
    kind: 'ride', minutes: 34, metres: 11240, speed: 15, geometry: [[0, 0], [1, 1]],
    profile: [[0, 10], [5000, 60], [11240, 55]], ascent: 85, descent: 40,
}

describe('RidePanel', () => {
    it('shows time, distance, speed, climb and the profile', () => {
        render(<RidePanel result={RIDE} onClose={vi.fn()}/>)
        expect(screen.getByText('Ride 34 min · 11.2 km at 15 km/h')).toBeInTheDocument()
        expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '↑ 85 m  ↓ 40 m')).toBeInTheDocument()
        expect(screen.getByRole('img', {name: 'Elevation profile'})).toBeInTheDocument()
    })

    it('omits the profile without elevation data', () => {
        render(<RidePanel result={{...RIDE, profile: null, ascent: null, descent: null}} onClose={vi.fn()}/>)
        expect(screen.queryByRole('img', {name: 'Elevation profile'})).not.toBeInTheDocument()
        expect(screen.queryByText(/↑/)).not.toBeInTheDocument()
    })

    it('missing path keeps time and distance', () => {
        render(<RidePanel result={{kind: 'missing', minutes: 34, metres: 11240, speed: 15}} onClose={vi.fn()}/>)
        expect(screen.getByText('Ride 34 min · 11.2 km at 15 km/h')).toBeInTheDocument()
        expect(screen.getByText('Route details unavailable')).toBeInTheDocument()
    })

    it('unreachable and outside messages', () => {
        const {rerender} = render(<RidePanel result={{kind: 'unreachable'}} onClose={vi.fn()}/>)
        expect(screen.getByText('No bike route within 3 h')).toBeInTheDocument()
        rerender(<RidePanel result={{kind: 'outside'}} onClose={vi.fn()}/>)
        expect(screen.getByText('Outside the mapped area')).toBeInTheDocument()
    })

    it('closes with Escape and the close button', async () => {
        const onClose = vi.fn()
        render(<RidePanel result={RIDE} onClose={onClose}/>)
        await userEvent.keyboard('{Escape}')
        await userEvent.click(screen.getByRole('button', {name: 'Close route'}))
        expect(onClose).toHaveBeenCalledTimes(2)
    })
})

describe('ElevationProfile', () => {
    it('labels its height range', () => {
        render(<ElevationProfile points={[[0, 12], [100, 70]]}/>)
        expect(screen.getByText('70 m')).toBeInTheDocument()
        expect(screen.getByText('12 m')).toBeInTheDocument()
    })

    it('shows a flat ride over at least 20 m', () => {
        render(<ElevationProfile points={[[0, 10], [100, 10], [200, 10]]}/>)
        expect(screen.getByText('20 m')).toBeInTheDocument()
        expect(screen.getByText('0 m')).toBeInTheDocument()
    })
})
