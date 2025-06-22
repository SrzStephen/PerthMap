import Map from '../src/components/Map/Map.tsx'
import SidePanel from "./components/Map/SidePanel.tsx";
import "leaflet/dist/leaflet.css"
import {useState} from "react";

function App() {
    const [distanceslider, setdistanceslider] = useState<number[]>([90])
    return (
        <div>
            <p className={"bg-slate-700 text-slate-100 text-3xl font-bold"}>Perth Map</p>
            <div className={"flex"}>
                <div className={"flex-auto w-3/4"}>
                    <Map filterVal={distanceslider[0]} filterCB={(value: number[]) => setdistanceslider(value)}/>
                </div>
                <div className={"flex-auto"}>
                    <SidePanel  filterVal={distanceslider[0]} filterCB={(value: number[]) => setdistanceslider(value)}/>
                </div>

            </div>

        </div>

    )
}

export default App
