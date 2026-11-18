import {useEffect, useRef, type ReactNode} from 'react'
import {MapContainer, Pane, Polygon, TileLayer, ZoomControl, useMap, useMapEvents} from 'react-leaflet'
import {bandColor, type Band} from '../../lib/bands'
import {CbdMarker} from './CbdMarker'

// Esri Light Gray Canvas: muted, keyless. Labels are a separate layer so they can sit above the bands.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas'
const BASE_TILES = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`
const LABEL_TILES = `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`
const ATTRIBUTION =
    'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

interface TravelTimeMapProps {
    minutes: number
    /** Largest time first. */
    bands: Band[]
    onMapClick?: (lat: number, lng: number) => void
    /** Route overlay, drawn above the bands and below the labels. */
    children?: ReactNode
    /** A searched place to fly to. */
    focus?: [number, number] | null
}

function FlyTo({focus}: { focus: [number, number] }) {
    const map = useMap()
    useEffect(() => {
        map.flyTo(focus, 15) // street level, with the surrounding intake area still in view
    }, [map, focus])
    return null
}

function ClickHandler({onMapClick}: { onMapClick: (lat: number, lng: number) => void }) {
    useMapEvents({click: e => onMapClick(e.latlng.lat, e.latlng.lng)})
    return null
}

/** Increments whenever `value` changes identity. */
function useGeneration(value: unknown) {
    const ref = useRef({value, gen: 0})
    if (ref.current.value !== value) ref.current = {value, gen: ref.current.gen + 1}
    return ref.current.gen
}

export function TravelTimeMap({minutes, bands, onMapClick, children, focus}: TravelTimeMapProps) {
    // Leaflet appends newly added paths last, so a band that appears with a new window would paint over the inner
    // ones. Remounting every band whenever the list changes keeps the largest-first paint order.
    const gen = useGeneration(bands)
    return (
        <MapContainer center={[-31.9514, 115.8617]} zoom={12} zoomControl={false} maxZoom={16} minZoom={9} className="h-full w-full">
            <TileLayer url={BASE_TILES} attribution={ATTRIBUTION} maxZoom={16}/>
            <ZoomControl position="bottomright"/>
            {onMapClick && <ClickHandler onMapClick={onMapClick}/>}
            {focus && <FlyTo focus={focus}/>}
            {/* Bands are opaque inside a translucent pane: smaller bands (later in the SVG) cover larger ones,
                so each area shows exactly one flat colour instead of stacked alpha. Every band stays mounted in
                largest-first order; hidden bands just drop their fill. */}
            <Pane name="bands" style={{zIndex: 350, opacity: 0.65}}>
                {bands.map(band => (
                    <Polygon
                        key={`${gen}-${band.time}`}
                        positions={band.positions}
                        interactive={false}
                        pathOptions={{
                            stroke: false,
                            fill: band.time <= minutes,
                            fillColor: bandColor(band.time),
                            fillOpacity: 1,
                        }}
                    />
                ))}
            </Pane>
            <Pane name="route" style={{zIndex: 400}}>
                {children}
            </Pane>
            <Pane name="labels" style={{zIndex: 450, pointerEvents: 'none'}}>
                <TileLayer url={LABEL_TILES} maxZoom={16}/>
            </Pane>
            <CbdMarker/>
        </MapContainer>
    )
}
