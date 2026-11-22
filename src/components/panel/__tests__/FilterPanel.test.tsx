import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {FilterPanel, EMPTY_FILTERS} from '../FilterPanel'
import {FILTERS} from '../../../lib/filters'
import type {LayerInfo} from '../../../lib/attrs'

const layer = (id: string, field: string, title: string): LayerInfo =>
    ({id, field, title, source: 's', licence: 'l', url: 'u', asOf: '2026-11-22', local: false})
const LAYERS = [layer('bushfire', 'bushfire', 'Bushfire prone areas'), layer('power', 'power_m', 'Powerlines and substations')]
const AVAILABLE = FILTERS.filter(f => ['bushfire', 'power'].includes(f.id))

function setup(props: Partial<Parameters<typeof FilterPanel>[0]> = {}) {
    const onChange = vi.fn(), onShownChange = vi.fn()
    render(<FilterPanel layers={LAYERS} filters={AVAILABLE} active={{}} onChange={onChange} shown={[]}
                        onShownChange={onShownChange} empty={false} {...props}/>)
    return {onChange, onShownChange}
}

const open = () => userEvent.click(screen.getByRole('button', {name: /Hazards & noise/}))

describe('FilterPanel', () => {
    it('is collapsed by default and counts active filters', () => {
        setup({active: {bushfire: 0, power: 200}})
        expect(screen.queryByRole('checkbox')).toBeNull()
        expect(screen.getByRole('button', {name: /Hazards & noise/}).textContent).toContain('(2 on)')
    })

    it('ticks a filter without a threshold', async () => {
        const {onChange} = setup()
        await open()
        await userEvent.click(screen.getByRole('checkbox', {name: 'Not bushfire prone'}))
        expect(onChange).toHaveBeenCalledWith({bushfire: 0})
    })

    it('ticks a filter at its default threshold and changes it', async () => {
        const {onChange} = setup({active: {power: 200}})
        await open()
        await userEvent.selectOptions(screen.getByRole('combobox', {name: 'Away from powerlines threshold'}), '500 m')
        expect(onChange).toHaveBeenCalledWith({power: 500})
        await userEvent.click(screen.getByRole('checkbox', {name: 'Away from powerlines'}))
        expect(onChange).toHaveBeenLastCalledWith({})
    })

    it('uses the default threshold when ticked', async () => {
        const {onChange} = setup()
        await open()
        await userEvent.click(screen.getByRole('checkbox', {name: 'Away from powerlines'}))
        expect(onChange).toHaveBeenCalledWith({power: 200})
    })

    it('offers only loaded layers', async () => {
        setup()
        await open()
        expect(screen.queryByRole('checkbox', {name: 'No high acid sulfate risk'})).toBeNull()
    })

    it('toggles a layer on the map', async () => {
        const {onShownChange} = setup()
        await open()
        const show = screen.getByRole('button', {name: 'Show Bushfire prone areas'})
        expect(show.getAttribute('aria-pressed')).toBe('false')
        await userEvent.click(show)
        expect(onShownChange).toHaveBeenCalledWith(['bushfire'])
    })

    it('says when nothing passes', async () => {
        setup({active: {bushfire: 0}, empty: true})
        expect(screen.getByText(EMPTY_FILTERS)).toBeTruthy()
        expect(EMPTY_FILTERS).toBe('No mapped area passes the selected filters')
    })
})
