import {describe, it, expect, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import type {ReactNode} from 'react'
import {TravelTimeMap} from '../TravelTimeMap'

vi.mock('../../../assets/poly.json', () => {
    const ring = [[115.8, -31.9], [115.9, -31.9], [115.9, -32.0], [115.8, -31.9]]
    const f = (time: number) => ({type: 'Feature', properties: {time}, geometry: {type: 'Polygon', coordinates: [ring]}})
    return {default: {type: 'FeatureCollection', features: [f(10), f(85), f(45)]}}
})

vi.mock('react-leaflet', () => {
    const Div = ({children}: { children?: ReactNode }) => <div>{children}</div>
    return {
        MapContainer: Div,
        Pane: Div,
        TileLayer: () => <div data-testid="tile-layer"/>,
        ZoomControl: () => null,
        Popup: ({children}: { children?: ReactNode }) => <div data-testid="popup">{children}</div>,
        Marker: () => <div data-testid="marker"/>,
        Polygon: ({children, pathOptions}: { children?: ReactNode; pathOptions: { fillColor: string } }) =>
            <div data-testid="polygon" data-fill={pathOptions.fillColor}>{children}</div>,
    }
})

const popups = () => screen.getAllByTestId('popup').map(p => p.textContent)

describe('TravelTimeMap', () => {
    it('shows bands up to the selected minutes, largest first', () => {
        render(<TravelTimeMap minutes={45}/>)
        expect(popups()).toEqual(['40–45 min', 'Under 10 min'])
    })

    it('shows only the innermost band at the minimum', () => {
        render(<TravelTimeMap minutes={10}/>)
        expect(popups()).toEqual(['Under 10 min'])
    })

    it('keeps largest-first order across slider changes', () => {
        const {rerender} = render(<TravelTimeMap minutes={85}/>)
        rerender(<TravelTimeMap minutes={45}/>)
        rerender(<TravelTimeMap minutes={85}/>)
        expect(popups()).toEqual(['80–85 min', '40–45 min', 'Under 10 min'])
    })

    it('fills the outermost band with the palellest colour', () => {
        render(<TravelTimeMap minutes={85}/>)
        expect(screen.getAllByTestId('polygon')[0]).toHaveAttribute('data-fill', '#ddd6fe')
    })

    it('renders the CBD marker', () => {
        render(<TravelTimeMap minutes={45}/>)
        expect(screen.getByTestId('marker')).toBeInTheDocument()
    })
})
