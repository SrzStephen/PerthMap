import {MapContainer, Pane, Polygon, Popup, TileLayer, ZoomControl} from 'react-leaflet'
import {bandColor, bandLabel} from '../../lib/bands'
import {BANDS, BAND_TIMES} from '../../lib/data'
import {CbdMarker} from './CbdMarker'

const INNERMOST = BAND_TIMES[0]

// Esri Light Gray Canvas: muted, keyless. Labels are a separate layer so they can sit above the bands.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas'
const BASE_TILES = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`
const LABEL_TILES = `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`
const ATTRIBUTION =
    'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export function TravelTimeMap({minutes}: { minutes: number }) {
    return (
        <MapContainer center={[-31.9514, 115.8617]} zoom={12} zoomControl={false} maxZoom={16} minZoom={9} className="h-full w-full">
            <TileLayer url={BASE_TILES} attribution={ATTRIBUTION} maxZoom={16}/>
            <ZoomControl position="bottomright"/>
            {/* Bands are opaque inside a translucent pane: smaller bands (later in the SVG) cover larger ones,
                so each area shows exactly one flat colour instead of stacked alpha. Every band stays mounted in
                fixed largest-first order — Leaflet appends newly added paths last, so mounting on demand would
                paint a newly revealed outer band over the inner ones. Hidden bands just drop their fill. */}
            <Pane name="bands" style={{zIndex: 350, opacity: 0.65}}>
                {BANDS.map(band => (
                    <Polygon
                        key={band.time}
                        positions={band.positions}
                        pathOptions={{
                            stroke: false,
                            fill: band.time <= minutes,
                            fillColor: bandColor(band.time),
                            fillOpacity: 1,
                        }}
                    >
                        <Popup pane="popupPane">{bandLabel(band.time, INNERMOST)}</Popup>
                    </Polygon>
                ))}
            </Pane>
            <Pane name="labels" style={{zIndex: 450, pointerEvents: 'none'}}>
                <TileLayer url={LABEL_TILES} maxZoom={16}/>
            </Pane>
            <CbdMarker/>
        </MapContainer>
    )
}
