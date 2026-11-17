import {describe, it, expect, vi, beforeEach} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {ControlCard} from '../ControlCard'

const mobile = vi.hoisted(() => ({value: false}))
vi.mock('../../../hooks/use-mobile', () => ({useIsMobile: () => mobile.value}))

describe('ControlCard', () => {
    beforeEach(() => {
        mobile.value = false
    })

    it('shows title, subtitle and the current value', () => {
        render(<ControlCard minutes={45} onMinutesChange={vi.fn()}/>)
        expect(screen.getByText('PerthMap')).toBeInTheDocument()
        expect(screen.getByText('Public transport time to Perth CBD')).toBeInTheDocument()
        expect(screen.getByTestId('minutes-value')).toHaveTextContent('45')
    })

    it('exposes an accessible slider that steps by 5 with the keyboard', async () => {
        const onChange = vi.fn()
        render(<ControlCard minutes={45} onMinutesChange={onChange}/>)
        const slider = screen.getByRole('slider', {name: 'Maximum travel time in minutes'})
        slider.focus()
        await userEvent.keyboard('{ArrowRight}')
        expect(onChange).toHaveBeenCalledWith(50)
    })

    it('has no collapse button on desktop', () => {
        render(<ControlCard minutes={45} onMinutesChange={vi.fn()}/>)
        expect(screen.queryByRole('button', {name: 'Collapse controls'})).toBeNull()
    })

    it('collapses to a bar on mobile that still shows the value', async () => {
        mobile.value = true
        render(<ControlCard minutes={45} onMinutesChange={vi.fn()}/>)
        await userEvent.click(screen.getByRole('button', {name: 'Collapse controls'}))
        expect(screen.queryByRole('slider')).toBeNull()
        expect(screen.getByTestId('minutes-value')).toHaveTextContent('45')

        expect(screen.getByRole('region', {name: 'Map controls'})).toHaveAttribute('data-sheet', 'collapsed')

        const expand = screen.getByRole('button', {name: 'Expand controls'})
        expect(expand).toHaveAttribute('aria-expanded', 'false')
        await userEvent.click(expand)
        expect(screen.getByRole('slider')).toBeInTheDocument()
        expect(screen.getByRole('region', {name: 'Map controls'})).toHaveAttribute('data-sheet', 'expanded')
    })
})
