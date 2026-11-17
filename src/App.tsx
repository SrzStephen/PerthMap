import 'leaflet/dist/leaflet.css'
import {useState} from 'react'
import {TravelTimeMap} from './components/map/TravelTimeMap'
import {ControlCard} from './components/panel/ControlCard'
import {BAND_TIMES} from './lib/data'

function App() {
    const [minutes, setMinutes] = useState(45)
    return (
        <main className="relative h-[100dvh] w-screen overflow-hidden">
            <TravelTimeMap minutes={minutes}/>
            <ControlCard times={BAND_TIMES} minutes={minutes} onMinutesChange={setMinutes}/>
        </main>
    )
}

export default App
