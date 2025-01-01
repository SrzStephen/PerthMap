import {MapContainer, Polygon, Popup, TileLayer} from "react-leaflet";

import poly from '../../assets/poly.json'
import {Fragment} from "react";

const addGeoData = (props:MapProps)=> {
    return (
        <Fragment>
            {
                poly.features.filter((polygon) => parseInt(polygon.properties.index) < props.filterVal).map((feature) =>
                    //SM: combo key forces refresh of all polys on slider refresh
                    // otherwise last poly (Biggest) is overlaid over all the small ones breaking hover/click function
                    <Polygon positions={feature.geometry.coordinates.map((polygon) => polygon.map(v => [v[1], v[0]]))}
                             key={`${feature.properties.index}_${props.filterVal}`}
                             pathOptions={{
                                 color: `rgba(0, 0, 0, 0.01)`,
                                 fillColor: `rgba(${feature.properties.r * 256},${feature.properties.g * 256},${feature.properties.b * 256},0.5)`,
                                 outline: 0
                             }}>
                        <Popup>{feature.properties.time}</Popup>
                    </Polygon>)

            }
        </Fragment>
    )
}


interface MapProps {
    filterVal: number,
    filterCB:(value: number[]) => void
}

const Map = (props: MapProps) => {
    console.log(addGeoData(props))
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
