import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {AmenityPicker} from '../AmenityPicker'

const TYPES = [{id: 'supermarket', label: 'Supermarkets', count: 399}, {id: 'park', label: 'Parks', count: 3201}]

describe('AmenityPicker', () => {
    it('is collapsed by default and counts shown types', () => {
        render(<AmenityPicker types={TYPES} selected={['park']} onChange={vi.fn()}/>)
        expect(screen.queryByRole('button', {name: /Supermarkets/})).toBeNull()
        expect(screen.getByRole('button', {name: /Amenities/}).textContent).toContain('(1 shown)')
    })

    it('toggles a type on and off', async () => {
        const onChange = vi.fn()
        const {rerender} = render(<AmenityPicker types={TYPES} selected={[]} onChange={onChange}/>)
        await userEvent.click(screen.getByRole('button', {name: /Amenities/}))
        const chip = screen.getByRole('button', {name: 'Supermarkets (399)'})
        expect(chip).toHaveAttribute('aria-pressed', 'false')
        await userEvent.click(chip)
        expect(onChange).toHaveBeenLastCalledWith(['supermarket'])
        rerender(<AmenityPicker types={TYPES} selected={['supermarket']} onChange={onChange}/>)
        await userEvent.click(screen.getByRole('button', {name: 'Supermarkets (399)'}))
        expect(onChange).toHaveBeenLastCalledWith([])
    })
})
