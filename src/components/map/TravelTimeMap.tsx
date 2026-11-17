import {MapContainer, Pane, Polygon, Popup, TileLayer, ZoomControl} from 'react-leaflet'
import poly from '../../assets/poly.json'
import {bandColor, bandLabel, parseBands, visibleBands} from '../../lib/bands'
import {CbdMarker} from './CbdMarker'

const BANDS = parseBands(poly)

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
            {/* Bands are opaque inside a translucent pane: smaller bands (drawn last) cover larger ones,
                so each area shows exactly one flat colour instead of stacked alpha. */}
            <Pane name="bands" style={{zIndex: 350, opacity: 0.65}}>
                {visibleBands(BANDS, minutes).map(band => (
                    <Polygon
                        key={band.time}
                        positions={band.positions}
                        pathOptions={{stroke: false, fillColor: bandColor(band.time), fillOpacity: 1}}
                    >
                        <Popup pane="popupPane">{bandLabel(band.time)}</Popup>
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
