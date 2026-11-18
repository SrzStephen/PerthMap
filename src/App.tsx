import 'leaflet/dist/leaflet.css'
import {useEffect, useState} from 'react'
import {TravelTimeMap} from './components/map/TravelTimeMap'
import {ControlCard} from './components/panel/ControlCard'
import {THRESHOLDS} from './lib/bands'
import {loadIndex, type DataIndex, type DayKey} from './lib/grid'
import {useWindowData} from './lib/useWindowData'

const DEFAULT_HOURS = Array.from({length: 16}, (_, i) => 6 + i)

function App() {
    const [index, setIndex] = useState<DataIndex | null>(null)
    const [indexFailed, setIndexFailed] = useState(false)
    const [minutes, setMinutes] = useState(45)
    const [day, setDay] = useState<DayKey>('weekday')
    const [hour, setHour] = useState(8)
    const {bands, status, retry} = useWindowData(index, day, hour)

    useEffect(() => {
        if (index) return
        loadIndex().then(setIndex, e => {
            console.error('loading index.json', e)
            setIndexFailed(true)
        })
    }, [index, indexFailed])

    return (
        <main className="relative h-[100dvh] w-screen overflow-hidden">
            <TravelTimeMap minutes={minutes} bands={bands}/>
            <ControlCard
                times={THRESHOLDS} minutes={minutes} onMinutesChange={setMinutes}
                days={index?.days ?? [{key: 'weekday', label: 'Weekday', date: ''}]} day={day} onDayChange={setDay}
                hours={index?.hours ?? DEFAULT_HOURS} hour={hour} onHourChange={setHour}
                status={indexFailed ? 'error' : status}
                onRetry={indexFailed ? () => setIndexFailed(false) : retry}
            />
        </main>
    )
}

export default App
