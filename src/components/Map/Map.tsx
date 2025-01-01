import {MapContainer, Polygon, Popup, TileLayer} from "react-leaflet";

import poly from '../../assets/poly.json'
import {Fragment} from "react";

// SM: By using the filter there + filtering by key what ends up happening is that the last poly is rendered over
// the top of every other poly, causing the popup to **always** show the last poly rendered
// TODO: Fix this
const addGeoData = (props:MapProps)=> {
    return (
        <Fragment>
            {
                poly.features.map((feature) =>

                    // GeoJson is
                    <Polygon className={`z-${100/feature.properties.time}`} positions={feature.geometry.coordinates.map((polygon) => polygon.map(v => [v[1], v[0]]))}
                             key={feature.properties.index}
                             pathOptions={{
                                 color: `rgba(0, 0, 0, 0.01)`,
                                 fillColor: `rgba(${feature.properties.r * 256},${feature.properties.g * 256},${feature.properties.b * 256},0.5)`,
                                 outline: 0
                             }}>
                        <Popup>{feature.properties.time}</Popup>
                    </Polygon>).filter((polygon) => parseInt(polygon.key) < props.filterVal)

            }
        </Fragment>
    )
}


interface MapProps {
    filterVal: number,
    filterCB:(value: number[]) => void
}

const Map = (props: MapProps) => {
    return (
        <div className={"h-screen"}>

            <MapContainer center={[-31.9514, 115.8617]} zoom={13} scrollWheelZoom={true} height={500}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {addGeoData(props)}
                {/*<Polygon positions={poly.features[0].geometry.coordinates} />*/}
                {/*<GeoJSON data={poly}></GeoJSON>*/}
            </MapContainer>
        </div>
    )


}

export default Map;
