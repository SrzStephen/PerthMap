import 'leaflet/dist/leaflet.css'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {TravelTimeMap} from './components/map/TravelTimeMap'
import {IntakeLayer} from './components/map/IntakeLayer'
import {ControlCard, type Mode} from './components/panel/ControlCard'
import {SchoolPicker} from './components/panel/SchoolPicker'
import {AddressSearch} from './components/panel/AddressSearch'
import {RideOverlay} from './components/route/RideOverlay'
import {RidePanel} from './components/route/RidePanel'
import {RouteOverlay} from './components/route/RouteOverlay'
import {PropertyReport} from './components/report/PropertyReport'
import {SchoolsSection, type SchoolsState} from './components/report/SchoolsSection'
import {THRESHOLDS} from './lib/bands'
import type {Place} from './lib/geocode'
import {loadIndex, type DataIndex, type DayKey} from './lib/grid'
import {intakeAt, intakeMask, loadSchoolData, type SchoolData} from './lib/schools'
import {useClickedRide} from './lib/useClickedRide'
import {useClickedRoute} from './lib/useClickedRoute'
import {useWindowData} from './lib/useWindowData'
import {pointTitle} from './lib/utils'
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

    const [schoolData, setSchoolData] = useState<SchoolData | 'loading' | 'error'>('loading')
    const [selected, setSelected] = useState<number[]>([])
    const mask = useMemo(() => (typeof schoolData === 'object' ? intakeMask(schoolData, selected) : null),
        [schoolData, selected])
    const maskEmpty = useMemo(() => !!mask && !mask.some(v => v === 1), [mask])

    const {grid, bands, status, retry, loadedKey} = useWindowData(index, view, mask)
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

    useEffect(() => {
        if (!index) return
        loadSchoolData(index.grid).then(setSchoolData, e => {
            console.error('loading school data', e)
            setSchoolData('error')
        })
    }, [index])

    const schools: SchoolsState = useMemo(() => {
        if (!clicked || !index) return null
        if (typeof schoolData === 'string') return schoolData
        return intakeAt(schoolData, index.grid, clicked[0], clicked[1]) ?? {primary: null, secondary: null}
    }, [clicked, index, schoolData])
    const highlight = useMemo(() => (schools && typeof schools === 'object'
        ? [schools.primary, schools.secondary].filter(s => s !== null).map(s => s.index) : []), [schools])

    // the searched address names the report until the next click
    const [place, setPlace] = useState<{ point: [number, number]; label: string } | null>(null)
    const [focus, setFocus] = useState<[number, number] | null>(null)
    const onMapClick = useCallback((lat: number, lng: number) => setClicked([lat, lng]), [])
    const onPlace = useCallback((p: Place) => {
        const point: [number, number] = [p.lat, p.lng]
        setClicked(point)
        setPlace({point, label: p.label})
        setFocus(point)
    }, [])
    const close = useCallback(() => setClicked(null), [])
    const loaded = typeof schoolData === 'object' ? schoolData : null
    const title = route && (place?.point === route.point ? place.label : pointTitle(route.point))

    return (
        <main className="relative h-[100dvh] w-screen overflow-hidden">
            <TravelTimeMap minutes={minutes} bands={bands} onMapClick={onMapClick} focus={focus}>
                {loaded && <IntakeLayer areas={loaded.areas} selected={selected} highlight={highlight}/>}
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
                filters={<>
                    <AddressSearch onSelect={onPlace}/>
                    {loaded && (
                        <SchoolPicker schools={loaded.schools} selected={selected} onChange={setSelected} empty={maskEmpty}/>
                    )}
                </>}
            >
                {route && title && (
                    <PropertyReport title={title} route={route} schools={schools}
                                    asOf={loaded?.asOf ?? null} onClose={close}/>
                )}
                {ride && (
                    <div aria-label="Property report">
                        <RidePanel result={ride.result} onClose={close}/>
                        <SchoolsSection schools={schools} asOf={loaded?.asOf ?? null}/>
                    </div>
                )}
            </ControlCard>
        </main>
    )
}

export default App
