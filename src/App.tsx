import 'leaflet/dist/leaflet.css'
import {useCallback, useEffect, useState} from 'react'
import {TravelTimeMap} from './components/map/TravelTimeMap'
import {ControlCard} from './components/panel/ControlCard'
import {RouteOverlay} from './components/route/RouteOverlay'
import {RoutePanel} from './components/route/RoutePanel'
import {THRESHOLDS} from './lib/bands'
import {loadIndex, type DataIndex, type DayKey} from './lib/grid'
import {loadRoutes, loadStops, resolveRoute, type RouteResult, type Routes, type Stops} from './lib/route'
import {useWindowData} from './lib/useWindowData'

const DEFAULT_HOURS = Array.from({length: 16}, (_, i) => 6 + i)

interface Resolved {
    result: RouteResult
    routes: Routes | null
    stops: Stops | null
}

function App() {
    const [index, setIndex] = useState<DataIndex | null>(null)
    const [indexFailed, setIndexFailed] = useState(false)
    const [minutes, setMinutes] = useState(45)
    const [day, setDay] = useState<DayKey>('weekday')
    const [hour, setHour] = useState(8)
    const {grid, bands, status, retry, loadedKey} = useWindowData(index, day, hour)
    const [clicked, setClicked] = useState<[number, number] | null>(null)
    const [route, setRoute] = useState<Resolved | null>(null)

    useEffect(() => {
        if (index) return
        loadIndex().then(setIndex, e => {
            console.error('loading index.json', e)
            setIndexFailed(true)
        })
    }, [index, indexFailed])

    // Resolve the clicked point against the window the map is showing (re-runs when the window changes).
    useEffect(() => {
        if (!clicked || !grid || !loadedKey) return
        let cancelled = false
        Promise.all([loadRoutes(loadedKey), loadStops()])
            .then(([routes, stops]) => !cancelled && setRoute({result: resolveRoute(grid, clicked[0], clicked[1], routes), routes, stops}))
            .catch(e => {
                console.error('loading route data', e)
                if (cancelled) return
                // the grid alone still answers outside / unreachable / walk, and gives the times
                const result = resolveRoute(grid, clicked[0], clicked[1], {samples: [], lines: [], shapes: [], trips: {}})
                setRoute({result, routes: null, stops: null})
            })
        return () => {
            cancelled = true
        }
    }, [clicked, grid, loadedKey])

    const onMapClick = useCallback((lat: number, lng: number) => setClicked([lat, lng]), [])
    const close = useCallback(() => {
        setClicked(null)
        setRoute(null)
    }, [])

    const days = index?.days ?? [{key: 'weekday', label: 'Weekday', date: ''}]
    const dayLabel = days.find(d => d.key === day)?.label ?? day
    const open = clicked && route

    return (
        <main className="relative h-[100dvh] w-screen overflow-hidden">
            <TravelTimeMap minutes={minutes} bands={bands} onMapClick={onMapClick}>
                {open && <RouteOverlay point={clicked} result={route.result} routes={route.routes} stops={route.stops}/>}
            </TravelTimeMap>
            <ControlCard
                times={THRESHOLDS} minutes={minutes} onMinutesChange={setMinutes}
                days={days} day={day} onDayChange={setDay}
                hours={index?.hours ?? DEFAULT_HOURS} hour={hour} onHourChange={setHour}
                status={indexFailed ? 'error' : status}
                onRetry={indexFailed ? () => setIndexFailed(false) : retry}
            >
                {open && <RoutePanel result={route.result} dayLabel={dayLabel} routes={route.routes} stops={route.stops} onClose={close}/>}
            </ControlCard>
        </main>
    )
}

export default App
