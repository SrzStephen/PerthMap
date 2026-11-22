import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import type {ReactNode} from 'react'
import {AmenityLayer} from '../AmenityLayer'
import {parseAmenities} from '../../../lib/amenities'

vi.mock('react-leaflet', () => ({
    Pane: ({children}: { children?: ReactNode }) => <div>{children}</div>,
    CircleMarker: ({pathOptions, children}: { pathOptions: { fillColor: string }; children?: ReactNode }) =>
        <div data-testid="dot" data-colour={pathOptions.fillColor}>{children}</div>,
    Tooltip: ({children}: { children?: ReactNode }) => <span data-testid="tip">{children}</span>,
}))

const DATA = parseAmenities({
    asOf: '2026-11-22', source: 'OSM',
    types: [['supermarket', 'Supermarkets'], ['park', 'Parks']],
    items: [[0, -31.93, 115.81, 'Coles Wembley'], [1, -31.94, 115.82, ''], [0, -31.95, 115.83, 'IGA']],
})

describe('AmenityLayer', () => {
    it('draws the selected types only, named or labelled by type', () => {
        render(<AmenityLayer data={DATA} selected={['park', 'supermarket']}/>)
        expect(screen.getAllByTestId('dot')).toHaveLength(3)
        expect(screen.getAllByTestId('tip').map(t => t.textContent)).toEqual(['Coles Wembley', 'IGA', 'Park'])
    })

    it('draws nothing with nothing selected', () => {
        render(<AmenityLayer data={DATA} selected={[]}/>)
        expect(screen.queryAllByTestId('dot')).toHaveLength(0)
    })
})
