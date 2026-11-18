import 'leaflet/dist/leaflet.css'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {TravelTimeMap} from './components/map/TravelTimeMap'
import {ControlCard, type Mode} from './components/panel/ControlCard'
import {RideOverlay} from './components/route/RideOverlay'
import {RidePanel} from './components/route/RidePanel'
import {RouteOverlay} from './components/route/RouteOverlay'
import {RoutePanel} from './components/route/RoutePanel'
import {THRESHOLDS} from './lib/bands'
import {loadIndex, type DataIndex, type DayKey} from './lib/grid'
import {useClickedRide} from './lib/useClickedRide'
import {useClickedRoute} from './lib/useClickedRoute'
import {useWindowData} from './lib/useWindowData'
import {isBikeKey, type View} from './lib/views'

const DEFAULT_HOURS = Array.from({length: 16}, (_, i) => 6 + i)
const DEFAULT_DAYS: DataIndex['days'] = [{key: 'weekday', label: 'Weekday', date: ''}]

function App() {
    const [index, setIndex] = useState<DataIndex | null>(null)
    const [indexFailed, setIndexFailed] = useState(false)
    const [minutes, setMinutes] = useState(45)
    const [day, setDay] = useState<DayKey>('weekday')
    const [hour, setHour] = useState(8)
    const [mode, setMode] = useState<Mode>('transit')
    const [speed, setSpeed] = useState(15)
    const bikeAvailable = !!index?.bike
    const view = useMemo<View>(() => mode === 'bike' && bikeAvailable ? {mode: 'bike', speed} : {mode: 'transit', day, hour},
        [mode, bikeAvailable, speed, day, hour])
    const {grid, bands, status, retry, loadedKey} = useWindowData(index, view)
    const [clicked, setClicked] = useState<[number, number] | null>(null)
    const days = useMemo(() => index?.days ?? DEFAULT_DAYS, [index])
    // each resolves against the view on screen; null while a newer view or click is still resolving
    const bikeOnScreen = isBikeKey(loadedKey)
    const route = useClickedRoute(clicked, bikeOnScreen ? null : grid, bikeOnScreen ? null : loadedKey, days)
    const ride = useClickedRide(clicked, bikeOnScreen ? grid : null, bikeOnScreen ? loadedKey : null, index)

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
                {ride && <RideOverlay point={ride.point} result={ride.result}/>}
            </TravelTimeMap>
            <ControlCard
                times={THRESHOLDS} minutes={minutes} onMinutesChange={setMinutes}
                days={days} day={day} onDayChange={setDay}
                hours={index?.hours ?? DEFAULT_HOURS} hour={hour} onHourChange={setHour}
                status={indexFailed ? 'error' : status}
                onRetry={indexFailed ? () => setIndexFailed(false) : retry}
                mode={view.mode} onModeChange={setMode} bikeAvailable={bikeAvailable} speed={speed} onSpeedChange={setSpeed}
            >
                {route && <RoutePanel result={route.result} dayLabel={route.dayLabel} routes={route.routes} stops={route.stops} onClose={close}/>}
                {ride && <RidePanel result={ride.result} onClose={close}/>}
            </ControlCard>
        </main>
    )
}

export default App
