import 'leaflet/dist/leaflet.css'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {TravelTimeMap} from './components/map/TravelTimeMap'
import {ControlCard} from './components/panel/ControlCard'
import {RouteOverlay} from './components/route/RouteOverlay'
import {RoutePanel} from './components/route/RoutePanel'
import {THRESHOLDS} from './lib/bands'
import {loadIndex, type DataIndex, type DayKey} from './lib/grid'
import {useClickedRoute} from './lib/useClickedRoute'
import {useWindowData} from './lib/useWindowData'

const DEFAULT_HOURS = Array.from({length: 16}, (_, i) => 6 + i)
const DEFAULT_DAYS: DataIndex['days'] = [{key: 'weekday', label: 'Weekday', date: ''}]

function App() {
    const [index, setIndex] = useState<DataIndex | null>(null)
    const [indexFailed, setIndexFailed] = useState(false)
    const [minutes, setMinutes] = useState(45)
    const [day, setDay] = useState<DayKey>('weekday')
    const [hour, setHour] = useState(8)
    const {grid, bands, status, retry, loadedKey} = useWindowData(index, {mode: 'transit', day, hour})
    const [clicked, setClicked] = useState<[number, number] | null>(null)
    const days = useMemo(() => index?.days ?? DEFAULT_DAYS, [index])
    // resolved against the window on screen; null while a newer window or click is still resolving
    const route = useClickedRoute(clicked, grid, loadedKey, days)

    useEffect(() => {
        if (index) return
        loadIndex().then(setIndex, e => {
            console.error('loading index.json', e)
            setIndexFailed(true)
        })
    }, [index, indexFailed])

    const onMapClick = useCallback((lat: number, lng: number) => setClicked([lat, lng]), [])
    const close = useCallback(() => setClicked(null), [])

    return (
        <main className="relative h-[100dvh] w-screen overflow-hidden">
            <TravelTimeMap minutes={minutes} bands={bands} onMapClick={onMapClick}>
                {route && <RouteOverlay point={route.point} result={route.result} routes={route.routes} stops={route.stops}/>}
            </TravelTimeMap>
            <ControlCard
                times={THRESHOLDS} minutes={minutes} onMinutesChange={setMinutes}
                days={days} day={day} onDayChange={setDay}
                hours={index?.hours ?? DEFAULT_HOURS} hour={hour} onHourChange={setHour}
                status={indexFailed ? 'error' : status}
                onRetry={indexFailed ? () => setIndexFailed(false) : retry}
            >
                {route && <RoutePanel result={route.result} dayLabel={route.dayLabel} routes={route.routes} stops={route.stops} onClose={close}/>}
            </ControlCard>
        </main>
    )
}

export default App
