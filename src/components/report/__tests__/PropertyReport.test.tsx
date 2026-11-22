import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {PropertyReport} from '../PropertyReport'
import type {ClickedRoute} from '../../../lib/useClickedRoute'
import type {School} from '../../../lib/schools'

const ROUTE: ClickedRoute = {
    point: [-31.93, 115.81], key: 'weekday-08', dayLabel: 'Weekday', routes: null, stops: null,
    result: {kind: 'walk', best: 18, typical: 20},
}
const school = (index: number, name: string, primary: boolean): School =>
    ({index, code: String(index), name, primary, secondary: !primary, lat: 0, lon: 0, hasIntake: true})
const WEMBLEY = school(0, 'Wembley Primary School', true)
const CHURCHLANDS = school(1, 'Churchlands Senior High School', false)
const CAVEAT = 'Approximate — from DoE maps; check the official lookup if near a boundary.'

const report = (schools: Parameters<typeof PropertyReport>[0]['schools'], onClose = vi.fn()) => {
    render(<PropertyReport title="12 Grantham Street, Wembley" route={ROUTE} schools={schools} asOf="2026-11-19" onClose={onClose}/>)
    return onClose
}

describe('PropertyReport', () => {
    it('heads with the address and keeps the route', () => {
        report({primary: WEMBLEY, secondary: CHURCHLANDS})
        expect(screen.getByRole('heading', {name: '12 Grantham Street, Wembley'})).toBeInTheDocument()
        expect(screen.getByText('Best 18 min · typical 20 min')).toBeInTheDocument()
    })

    it('lists both intake schools with the caveat, official link and date', () => {
        report({primary: WEMBLEY, secondary: CHURCHLANDS})
        expect(screen.getByText('Primary: Wembley Primary School')).toBeInTheDocument()
        expect(screen.getByText('Secondary: Churchlands Senior High School')).toBeInTheDocument()
        expect(screen.getByText(CAVEAT)).toBeInTheDocument()
        expect(screen.getByRole('link', {name: /official lookup/i})).toHaveAttribute('href', 'https://www.det.wa.edu.au/schoolsonline/home.do')
        expect(screen.getByText('As of 2026-11-19')).toBeInTheDocument()
    })

    it('says when a level has no intake area', () => {
        report({primary: WEMBLEY, secondary: null})
        expect(screen.getByText('No public secondary intake area here')).toBeInTheDocument()
    })

    it('keeps the route when school data failed', () => {
        report('error')
        expect(screen.getByText('School data unavailable')).toBeInTheDocument()
        expect(screen.getByText('Best 18 min · typical 20 min')).toBeInTheDocument()
    })

    it('closes on Escape', async () => {
        const onClose = report({primary: null, secondary: null})
        await userEvent.keyboard('{Escape}')
        expect(onClose).toHaveBeenCalled()
    })

    it('keeps the route when hazard data fails', () => {
        render(<PropertyReport title="t" route={ROUTE} schools={null} asOf={null} attrs="error" onClose={vi.fn()}/>)
        expect(screen.getByText('Best 18 min · typical 20 min')).toBeInTheDocument()
        expect(screen.getByText('Hazard data unavailable')).toBeInTheDocument()
    })
})
