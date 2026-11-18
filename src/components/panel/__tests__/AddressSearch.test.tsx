import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {AddressSearch} from '../AddressSearch'
import type {Place} from '../../../lib/geocode'

const WEMBLEY: Place = {label: '12 Grantham Street, Wembley', lat: -31.93, lng: 115.81}
const FLOREAT: Place = {label: '12 Grantham Street, Floreat', lat: -31.94, lng: 115.79}

const setup = (results: Place[] | Error) => {
    const search = vi.fn(async () => {
        if (results instanceof Error) throw results
        return results
    })
    const onSelect = vi.fn()
    render(<AddressSearch onSelect={onSelect} search={search}/>)
    return {search, onSelect, box: screen.getByRole('searchbox', {name: 'Search an address'})}
}

describe('AddressSearch', () => {
    it('does not search while typing', async () => {
        const {search, box} = setup([WEMBLEY])
        await userEvent.type(box, '12 Grantham')
        expect(search).not.toHaveBeenCalled()
    })

    it('searches once on Enter and selects a single match', async () => {
        const {search, onSelect, box} = setup([WEMBLEY])
        await userEvent.type(box, '12 Grantham St{Enter}')
        expect(search).toHaveBeenCalledTimes(1)
        expect(onSelect).toHaveBeenCalledWith(WEMBLEY)
    })

    it('lets the user choose between several matches', async () => {
        const {onSelect, box} = setup([WEMBLEY, FLOREAT])
        await userEvent.type(box, '12 Grantham St{Enter}')
        expect(onSelect).not.toHaveBeenCalled()
        await userEvent.click(await screen.findByRole('button', {name: FLOREAT.label}))
        expect(onSelect).toHaveBeenCalledWith(FLOREAT)
    })

    it('says when nothing matched', async () => {
        const {onSelect, box} = setup([])
        await userEvent.type(box, 'nowhere{Enter}')
        expect(await screen.findByText('No match in the mapped area')).toBeInTheDocument()
        expect(onSelect).not.toHaveBeenCalled()
    })

    it('says when search failed', async () => {
        const {box} = setup(new Error('503'))
        await userEvent.type(box, 'x{Enter}')
        expect(await screen.findByText('Search unavailable')).toBeInTheDocument()
    })

    it('credits OpenStreetMap', () => {
        setup([])
        expect(screen.getByText('Search © OpenStreetMap contributors (Nominatim)')).toBeInTheDocument()
    })
})
