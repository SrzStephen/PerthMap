import {describe, it, expect, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import type {ReactNode} from 'react'
import {TravelTimeMap} from '../TravelTimeMap'
import type {Band} from '../../../lib/bands'

const handlers = vi.hoisted(() => ({click: undefined as undefined | ((e: { latlng: { lat: number; lng: number } }) => void)}))
const flyTo = vi.hoisted(() => vi.fn())

vi.mock('react-leaflet', () => {
    const Div = ({children}: { children?: ReactNode }) => <div>{children}</div>
    return {
        MapContainer: Div,
        Pane: ({children, name}: { children?: ReactNode; name: string }) => <div data-pane-name={name}>{children}</div>,
        TileLayer: ({url}: { url: string }) => <div data-testid="tile-layer" data-url={url}/>,
        ZoomControl: () => null,
        useMap: () => ({flyTo}),
        Marker: () => <div data-testid="marker"/>,
        useMapEvents: (h: typeof handlers) => {
            handlers.click = h.click
            return null
        },
        // Only painted (fill: true) bands are visible, so the mock renders only those.
        Polygon: ({pathOptions}: { pathOptions: { fill: boolean; fillColor: string } }) =>
            pathOptions.fill ? <div data-testid="polygon" data-fill={pathOptions.fillColor}/> : null,
    }
})

const band = (time: number): Band => ({time, positions: [[[[-31.9, 115.8], [-31.9, 115.9], [-32, 115.9]]]]})
const BANDS = [band(85), band(45), band(15)]
const fills = () => screen.getAllByTestId('polygon').map(p => p.dataset.fill)

describe('TravelTimeMap', () => {
    it('renders one painted path per band up to the selected minutes, largest first', () => {
        render(<TravelTimeMap minutes={45} bands={BANDS}/>)
        expect(screen.getAllByTestId('polygon')).toHaveLength(2)
    })

    it('fills the outermost band with the palest colour', () => {
        render(<TravelTimeMap minutes={85} bands={BANDS}/>)
        expect(fills()[0]).toBe('#ede9fe')
    })

    it('renders nothing for an empty band list', () => {
        render(<TravelTimeMap minutes={45} bands={[]}/>)
        expect(screen.queryAllByTestId('polygon')).toHaveLength(0)
    })

    it('calls onMapClick with the clicked point', () => {
        const onMapClick = vi.fn()
        render(<TravelTimeMap minutes={45} bands={BANDS} onMapClick={onMapClick}/>)
        handlers.click?.({latlng: {lat: -31.95, lng: 115.86}})
        expect(onMapClick).toHaveBeenCalledWith(-31.95, 115.86)
    })

    it('renders overlay children in a route pane', () => {
        render(<TravelTimeMap minutes={45} bands={BANDS}><span data-testid="overlay"/></TravelTimeMap>)
        expect(screen.getByTestId('overlay').closest('[data-pane-name]')).toHaveAttribute('data-pane-name', 'route')
    })

    it('uses keyless Esri light gray base and label tiles', () => {
        render(<TravelTimeMap minutes={45} bands={BANDS}/>)
        const urls = screen.getAllByTestId('tile-layer').map(t => t.dataset.url)
        expect(urls).toEqual([
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        ])
    })

    it('renders the CBD marker', () => {
        render(<TravelTimeMap minutes={45} bands={BANDS}/>)
        expect(screen.getByTestId('marker')).toBeInTheDocument()
    })
})

describe('TravelTimeMap focus', () => {
    it('flies to a searched place', () => {
        const {rerender} = render(<TravelTimeMap minutes={45} bands={BANDS}/>)
        expect(flyTo).not.toHaveBeenCalled()
        rerender(<TravelTimeMap minutes={45} bands={BANDS} focus={[-31.93, 115.81]}/>)
        expect(flyTo).toHaveBeenCalledWith([-31.93, 115.81], 16)
    })
})
