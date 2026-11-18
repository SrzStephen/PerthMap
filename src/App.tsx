import 'leaflet/dist/leaflet.css'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {TravelTimeMap} from './components/map/TravelTimeMap'
import {IntakeLayer} from './components/map/IntakeLayer'
import {ControlCard} from './components/panel/ControlCard'
import {SchoolPicker} from './components/panel/SchoolPicker'
import {RouteOverlay} from './components/route/RouteOverlay'
import {PropertyReport} from './components/report/PropertyReport'
import type {SchoolsState} from './components/report/SchoolsSection'
import {THRESHOLDS} from './lib/bands'
import {loadIndex, type DataIndex, type DayKey} from './lib/grid'
import {intakeAt, intakeMask, loadSchoolData, type SchoolData} from './lib/schools'
import {useClickedRoute} from './lib/useClickedRoute'
import {useWindowData} from './lib/useWindowData'
import {pointTitle} from './lib/utils'

const DEFAULT_HOURS = Array.from({length: 16}, (_, i) => 6 + i)
const DEFAULT_DAYS: DataIndex['days'] = [{key: 'weekday', label: 'Weekday', date: ''}]

function App() {
    const [index, setIndex] = useState<DataIndex | null>(null)
    const [indexFailed, setIndexFailed] = useState(false)
    const [minutes, setMinutes] = useState(45)
    const [day, setDay] = useState<DayKey>('weekday')
    const [hour, setHour] = useState(8)

    const [schoolData, setSchoolData] = useState<SchoolData | 'loading' | 'error'>('loading')
    const [selected, setSelected] = useState<number[]>([])
    const mask = useMemo(() => (typeof schoolData === 'object' ? intakeMask(schoolData, selected) : null),
        [schoolData, selected])
    const maskEmpty = useMemo(() => !!mask && !mask.some(v => v === 1), [mask])

    const {grid, bands, status, retry, loadedKey} = useWindowData(index, day, hour, mask)
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

    const onMapClick = useCallback((lat: number, lng: number) => setClicked([lat, lng]), [])
    const close = useCallback(() => setClicked(null), [])
    const loaded = typeof schoolData === 'object' ? schoolData : null

    return (
        <main className="relative h-[100dvh] w-screen overflow-hidden">
            <TravelTimeMap minutes={minutes} bands={bands} onMapClick={onMapClick}>
                {loaded && <IntakeLayer areas={loaded.areas} selected={selected} highlight={highlight}/>}
                {route && <RouteOverlay point={route.point} result={route.result} routes={route.routes} stops={route.stops}/>}
            </TravelTimeMap>
            <ControlCard
                times={THRESHOLDS} minutes={minutes} onMinutesChange={setMinutes}
                days={days} day={day} onDayChange={setDay}
                hours={index?.hours ?? DEFAULT_HOURS} hour={hour} onHourChange={setHour}
                status={indexFailed ? 'error' : status}
                onRetry={indexFailed ? () => setIndexFailed(false) : retry}
                filters={loaded && (
                    <SchoolPicker schools={loaded.schools} selected={selected} onChange={setSelected} empty={maskEmpty}/>
                )}
            >
                {route && (
                    <PropertyReport title={pointTitle(route.point)} route={route} schools={schools}
                                    asOf={loaded?.asOf ?? null} onClose={close}/>
                )}
            </ControlCard>
        </main>
    )
}

export default App
