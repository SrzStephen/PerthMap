import {MapContainer, Pane, Polygon, Popup, TileLayer, ZoomControl} from 'react-leaflet'
import poly from '../../assets/poly.json'
import {bandColor, bandLabel, parseBands, visibleBands} from '../../lib/bands'
import {CbdMarker} from './CbdMarker'

const BANDS = parseBands(poly)

const TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

export function TravelTimeMap({minutes}: { minutes: number }) {
    return (
        <MapContainer center={[-31.9514, 115.8617]} zoom={12} zoomControl={false} className="h-full w-full">
            <TileLayer url={TILES} attribution={ATTRIBUTION} subdomains="abcd" maxZoom={19}/>
            <ZoomControl position="bottomright"/>
            {/* Bands are opaque inside a translucent pane: smaller bands (drawn last) cover larger ones,
                so each area shows exactly one flat colour instead of stacked alpha. */}
            <Pane name="bands" style={{zIndex: 350, opacity: 0.55}}>
                {visibleBands(BANDS, minutes).map(band => (
                    <Polygon
                        key={band.time}
                        positions={band.positions}
                        pathOptions={{stroke: false, fillColor: bandColor(band.time), fillOpacity: 1}}
                    >
                        <Popup>{bandLabel(band.time)}</Popup>
                    </Polygon>
                ))}
            </Pane>
            <CbdMarker/>
        </MapContainer>
    )
}
