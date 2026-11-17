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
        TileLayer: ({url}: { url: string }) => <div data-testid="tile-layer" data-url={url}/>,
        ZoomControl: () => null,
        Popup: ({children, pane}: { children?: ReactNode; pane?: string }) =>
            <div data-testid="popup" data-pane={pane}>{children}</div>,
        Marker: () => <div data-testid="marker"/>,
        // Only painted (fill: true) bands are visible/clickable, so the mock renders only those.
        Polygon: ({children, pathOptions}: { children?: ReactNode; pathOptions: { fill: boolean; fillColor: string } }) =>
            pathOptions.fill ? <div data-testid="polygon" data-fill={pathOptions.fillColor}>{children}</div> : null,
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

    // Real paint order is covered by TravelTimeMap.leaflet.test.tsx; this checks React-level ordering only.
    it('keeps largest-first order across slider changes', () => {
        const {rerender} = render(<TravelTimeMap minutes={85}/>)
        rerender(<TravelTimeMap minutes={45}/>)
        rerender(<TravelTimeMap minutes={85}/>)
        expect(popups()).toEqual(['80–85 min', '40–45 min', 'Under 10 min'])
    })

    it('fills the outermost band with the palellest colour', () => {
        render(<TravelTimeMap minutes={85}/>)
        expect(screen.getAllByTestId('polygon')[0]).toHaveAttribute('data-fill', '#ede9fe')
    })

    it('uses keyless Esri light gray base and label tiles', () => {
        render(<TravelTimeMap minutes={45}/>)
        const urls = screen.getAllByTestId('tile-layer').map(t => t.dataset.url)
        expect(urls).toEqual([
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        ])
    })

    it('opens popups in the popup pane, not inside the translucent bands pane', () => {
        render(<TravelTimeMap minutes={45}/>)
        for (const p of screen.getAllByTestId('popup')) expect(p).toHaveAttribute('data-pane', 'popupPane')
    })

    it('renders the CBD marker', () => {
        render(<TravelTimeMap minutes={45}/>)
        expect(screen.getByTestId('marker')).toBeInTheDocument()
    })
})
