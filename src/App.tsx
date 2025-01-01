import Map from '../src/components/Map/Map.tsx'
import SidePanel from "./components/Map/SidePanel.tsx";
import "leaflet/dist/leaflet.css"
import {useState} from "react";


function App() {
    const [distanceslider, setdistanceslider] = useState(90)
    return (
        <div>
            <p className={"bg-amber-400 text-3xl font-bold underline"}>aaa</p>
            <div className={"flex"}>
                <div className={"flex-auto w-3/4"}>
                    <Map filterVal={distanceslider} filterCB={setdistanceslider}/>
                </div>
                <div className={"flex-auto"}>
                    <SidePanel filterVal={distanceslider} filterCB={setdistanceslider}/>
                </div>

            </div>

        </div>

    )
}

export default App
