import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {SchoolPicker} from '../SchoolPicker'
import type {School} from '../../../lib/schools'

const s = (index: number, name: string, primary: boolean, secondary: boolean, hasIntake = true): School =>
    ({index, code: String(index), name, primary, secondary, lat: 0, lon: 0, hasIntake})
const SCHOOLS = [
    s(0, 'Wembley Primary School', true, false),
    s(1, 'Churchlands Senior High School', false, true),
    s(2, 'Churchlands Primary School', true, false),
    s(3, 'Perth Modern School', false, true, false),
    s(4, 'Mindarie College', true, true),
]

describe('SchoolPicker', () => {
    it('filters schools with an intake area by name', async () => {
        render(<SchoolPicker schools={SCHOOLS} selected={[]} onChange={vi.fn()} empty={false}/>)
        await userEvent.type(screen.getByRole('searchbox', {name: 'Find a school'}), 'church')
        const options = screen.getAllByRole('option').map(o => o.textContent)
        expect(options).toEqual(['Churchlands Senior High SchoolSecondary', 'Churchlands Primary SchoolPrimary'])
    })

    it('omits schools without an intake area and labels K–12', async () => {
        render(<SchoolPicker schools={SCHOOLS} selected={[]} onChange={vi.fn()} empty={false}/>)
        await userEvent.type(screen.getByRole('searchbox', {name: 'Find a school'}), 'o')
        const names = screen.getAllByRole('option').map(o => o.textContent)
        expect(names.some(n => n?.startsWith('Perth Modern'))).toBe(false)
        expect(names).toContain('Mindarie CollegeK–12')
    })

    it('adds a school and clears the search', async () => {
        const onChange = vi.fn()
        render(<SchoolPicker schools={SCHOOLS} selected={[1]} onChange={onChange} empty={false}/>)
        const box = screen.getByRole('searchbox', {name: 'Find a school'})
        await userEvent.type(box, 'wembley')
        await userEvent.click(screen.getByRole('option', {name: /Wembley Primary School/}))
        expect(onChange).toHaveBeenCalledWith([1, 0])
        expect(box).toHaveValue('')
    })

    it('removes a selected school via its chip', async () => {
        const onChange = vi.fn()
        render(<SchoolPicker schools={SCHOOLS} selected={[1, 0]} onChange={onChange} empty={false}/>)
        await userEvent.click(screen.getByRole('button', {name: 'Remove Churchlands Senior High School'}))
        expect(onChange).toHaveBeenCalledWith([0])
    })

    it('says when the chosen intake areas are outside the mapped area', () => {
        render(<SchoolPicker schools={SCHOOLS} selected={[0]} onChange={vi.fn()} empty/>)
        expect(screen.getByText('Selected intake areas are outside the mapped area')).toBeInTheDocument()
    })
})
