import {LayerGroup, LayersControl, MapContainer, Marker, Polygon, Popup, TileLayer} from "react-leaflet";

import poly from '../../assets/poly.json'
import {Fragment} from "react";
import L from 'leaflet'

L.Icon.Default.imagePath = 'img/'

const addGeoData = (props: MapProps) => {
    return (
        <Fragment>
            {
                poly.features.filter((polygon) => Number(polygon.properties.index) < props.filterVal).map((feature) =>
                    //SM: combo key forces refresh of all polys on slider refresh
                    // otherwise last poly (Biggest) is overlaid over all the small ones breaking hover/click function
                    <Polygon
                        positions={feature.geometry.coordinates.map((polygon) => polygon.map(v => [v[1], v[0]] as [number, number]))}
                        key={`${feature.properties.index}_${props.filterVal}`}
                        pathOptions={{
                            color: `rgba(0, 0, 0, 0.01)`,
                            fillColor: `rgba(${feature.properties.r * 256},${feature.properties.g * 256},${feature.properties.b * 256},0.5)`,
                            stroke: false
                        }}>
                        <Popup>{feature.properties.time} Minutes</Popup>
                    </Polygon>)

            }
        </Fragment>
    )
}


interface MapProps {
    filterVal: number,
    filterCB: (value: number[]) => void
}

const Map = (props: MapProps) => {
    return (
        <div className={"h-screen"}>

            <MapContainer center={[-31.9514, 115.8617]} zoom={13} scrollWheelZoom={true} className="h-[500px]">
                <LayersControl position="topright">
                    <LayersControl.Overlay checked name="Map">
                        <LayerGroup>
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
                        </LayerGroup>
                    </LayersControl.Overlay>

                    <LayersControl.Overlay checked name="Distance to Perth">
                        <LayerGroup>
                            {addGeoData(props)}
                            <Marker position={[-31.955612, 115.860234]}>
                                <Popup>Work</Popup>
                            </Marker>
                        </LayerGroup>
                    </LayersControl.Overlay>
                    {/*<WMSTileLayer url={"https://public-services.slip.wa.gov.au/public/services/SLIP_Public_Services/Property_and_Planning/MapServer/WMSServer"} params={{layers:78}}/>*/}
                </LayersControl>
            </MapContainer>
        </div>
    )


}

export default Map;
