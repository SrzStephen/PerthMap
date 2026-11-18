import {describe, it, expect, vi, beforeEach} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {ComponentProps} from 'react'
import {ControlCard} from '../ControlCard'
import {THRESHOLDS} from '../../../lib/bands'

const mobile = vi.hoisted(() => ({value: false}))
vi.mock('../../../hooks/use-mobile', () => ({useIsMobile: () => mobile.value}))

const DAYS = [
    {key: 'weekday' as const, label: 'Weekday', date: '2026-11-25'},
    {key: 'saturday' as const, label: 'Saturday', date: '2026-11-21'},
    {key: 'sunday' as const, label: 'Sunday', date: '2026-11-22'},
]
const HOURS = Array.from({length: 16}, (_, i) => 6 + i)

function card(props: Partial<ComponentProps<typeof ControlCard>> = {}) {
    const all: ComponentProps<typeof ControlCard> = {
        times: THRESHOLDS, minutes: 45, onMinutesChange: vi.fn(),
        days: DAYS, day: 'weekday', onDayChange: vi.fn(),
        hours: HOURS, hour: 8, onHourChange: vi.fn(),
        status: 'ready', onRetry: vi.fn(),
        ...props,
    }
    render(<ControlCard {...all}/>)
    return all
}

describe('ControlCard', () => {
    beforeEach(() => {
        mobile.value = false
    })

    it('shows title, subtitle and the current value', () => {
        card()
        expect(screen.getByText('PerthMap')).toBeInTheDocument()
        expect(screen.getByText('Public transport time to Perth CBD')).toBeInTheDocument()
        expect(screen.getByTestId('minutes-value')).toHaveTextContent('45')
    })

    it('exposes an accessible minutes slider that steps by 5 with the keyboard', async () => {
        const p = card()
        const slider = screen.getByRole('slider', {name: 'Maximum travel time in minutes'})
        expect(slider).toHaveAttribute('aria-valuemin', '15')
        expect(slider).toHaveAttribute('aria-valuemax', '85')
        slider.focus()
        await userEvent.keyboard('{ArrowRight}')
        expect(p.onMinutesChange).toHaveBeenCalledWith(50)
    })

    it('picks the day with a three-way toggle', async () => {
        const p = card()
        const radios = screen.getAllByRole('radio')
        expect(radios.map(r => r.textContent)).toEqual(['Weekday', 'Saturday', 'Sunday'])
        expect(screen.getByRole('radio', {name: 'Weekday'})).toHaveAttribute('aria-checked', 'true')
        await userEvent.click(screen.getByRole('radio', {name: 'Saturday'}))
        expect(p.onDayChange).toHaveBeenCalledWith('saturday')
    })

    it('labels and steps the arrival hour slider', async () => {
        const p = card()
        expect(screen.getByText('Arrive 08:00–09:00')).toBeInTheDocument()
        const slider = screen.getByRole('slider', {name: 'Arrival hour'})
        expect(slider).toHaveAttribute('aria-valuemin', '6')
        expect(slider).toHaveAttribute('aria-valuemax', '21')
        slider.focus()
        await userEvent.keyboard('{ArrowRight}')
        expect(p.onHourChange).toHaveBeenCalledWith(9)
    })

    it('shows a load error with retry', async () => {
        const p = card({status: 'error'})
        expect(screen.getByText("Couldn't load Weekday 08:00 data")).toBeInTheDocument()
        await userEvent.click(screen.getByRole('button', {name: 'Retry'}))
        expect(p.onRetry).toHaveBeenCalled()
    })

    it('shows a loading indicator', () => {
        card({status: 'loading'})
        expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('replaces the sliders with the route panel slot', () => {
        render(<ControlCard {...{
            times: THRESHOLDS, minutes: 45, onMinutesChange: vi.fn(), days: DAYS, day: 'weekday', onDayChange: vi.fn(),
            hours: HOURS, hour: 8, onHourChange: vi.fn(), status: 'ready', onRetry: vi.fn(),
        }}><p>route here</p></ControlCard>)
        expect(screen.getByText('route here')).toBeInTheDocument()
        expect(screen.queryByRole('slider', {name: 'Maximum travel time in minutes'})).toBeNull()
        expect(screen.getByRole('slider', {name: 'Arrival hour'})).toBeInTheDocument()
    })

    it('has no collapse button on desktop', () => {
        card()
        expect(screen.queryByRole('button', {name: 'Collapse controls'})).toBeNull()
    })

    it('collapses to a bar on mobile that still shows the value', async () => {
        mobile.value = true
        card()
        await userEvent.click(screen.getByRole('button', {name: 'Collapse controls'}))
        expect(screen.queryByRole('slider')).toBeNull()
        expect(screen.getByTestId('minutes-value')).toHaveTextContent('45')
        expect(screen.getByRole('region', {name: 'Map controls'})).toHaveAttribute('data-sheet', 'collapsed')
        const expand = screen.getByRole('button', {name: 'Expand controls'})
        expect(expand).toHaveAttribute('aria-expanded', 'false')
        await userEvent.click(expand)
        expect(screen.getAllByRole('slider')).toHaveLength(2)
        expect(screen.getByRole('region', {name: 'Map controls'})).toHaveAttribute('data-sheet', 'expanded')
    })
})
