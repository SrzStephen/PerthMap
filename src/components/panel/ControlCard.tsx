import {useState, type ReactNode} from 'react'
import {ChevronDown, ChevronUp, LoaderCircle} from 'lucide-react'
import {Slider} from '../ui/slider'
import {Legend} from './Legend'
import {DayToggle} from './DayToggle'
import {Segmented} from './Segmented'
import {useIsMobile} from '../../hooks/use-mobile'
import {cn} from '../../lib/utils'
import type {DataIndex, DayKey} from '../../lib/grid'
import type {WindowStatus} from '../../lib/useWindowData'

interface ControlCardProps {
    /** Band thresholds, ascending. */
    times: number[]
    minutes: number
    onMinutesChange: (minutes: number) => void
    days: DataIndex['days']
    day: DayKey
    onDayChange: (day: DayKey) => void
    hours: number[]
    hour: number
    onHourChange: (hour: number) => void
    status: WindowStatus
    onRetry: () => void
    mode: Mode
    onModeChange: (mode: Mode) => void
    /** index.json has bike data; otherwise there is no mode toggle. */
    bikeAvailable: boolean
    speed: number
    onSpeedChange: (speed: number) => void
    /** Route panel; replaces the minutes slider and legend while present. */
    children?: ReactNode
    /** Filters (school picker), shown under the day and hour. */
    filters?: ReactNode
}

export type Mode = 'transit' | 'bike'

export const SPEEDS = [12, 15, 20, 25] as const
export const SPEED_NOTE = 'leisurely · commuter · fit · e-bike'
const MODES: { value: Mode; label: string }[] = [{value: 'transit', label: 'Transit'}, {value: 'bike', label: 'Bike'}]
const SPEED_OPTIONS = SPEEDS.map(v => ({value: v as number, label: `${v} km/h`}))

const pad = (h: number) => String(h).padStart(2, '0')
const hourLabel = (h: number) => `Arrive ${pad(h)}:00–${pad(h + 1)}:00`

const Value = ({minutes, size}: { minutes: number; size: 'lg' | 'sm' }) => (
    <span className={cn('font-semibold tabular-nums tracking-tight', size === 'lg' ? 'text-5xl' : 'text-base')}>
        <span data-testid="minutes-value">{minutes}</span>
        <span className={cn('ml-1 font-medium text-[var(--muted)]', size === 'lg' ? 'text-lg' : 'text-sm')}>min</span>
    </span>
)

export function ControlCard(props: ControlCardProps) {
    const {times, minutes, onMinutesChange, days, day, onDayChange, hours, hour, onHourChange, status, onRetry, children, filters} = props
    const {mode, onModeChange, bikeAvailable, speed, onSpeedChange} = props
    const bike = mode === 'bike'
    const isMobile = useIsMobile()
    const [expanded, setExpanded] = useState(true)
    const open = !isMobile || expanded
    const dayLabel = days.find(d => d.key === day)?.label ?? day

    return (
        <section
            aria-label="Map controls"
            data-sheet={isMobile ? (expanded ? 'expanded' : 'collapsed') : undefined}
            className={cn(
                'glass absolute z-[1000] rounded-2xl text-[var(--text)]',
                isMobile ? 'inset-x-4 bottom-4 max-h-[70dvh] overflow-y-auto p-4' : 'top-4 left-4 w-[320px] p-5',
            )}
        >
            <header className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-lg font-semibold leading-tight tracking-tight">
                        PerthMap
                        {status === 'loading' && (
                            <LoaderCircle role="status" aria-label="Loading" size={14} className="animate-spin text-[var(--muted)]"/>
                        )}
                    </h1>
                    {open && <p className="text-sm text-[var(--muted)]">{bike ? 'Bike time to Perth CBD' : 'Public transport time to Perth CBD'}</p>}
                </div>
                {isMobile && (
                    <div className="flex items-center gap-2">
                        {!open && <Value minutes={minutes} size="sm"/>}
                        <button
                            type="button"
                            onClick={() => setExpanded(e => !e)}
                            aria-expanded={expanded}
                            aria-label={expanded ? 'Collapse controls' : 'Expand controls'}
                            className="rounded-full p-1.5 text-[var(--muted)] hover:bg-slate-900/5"
                        >
                            {expanded ? <ChevronDown size={18}/> : <ChevronUp size={18}/>}
                        </button>
                    </div>
                )}
            </header>

            {open && (
                <>
                    <div className="mt-4 space-y-3">
                        {bikeAvailable && <Segmented label="Mode" options={MODES} value={mode} onChange={onModeChange}/>}
                        {bike ? (
                            <div>
                                <Segmented label="Speed" options={SPEED_OPTIONS} value={speed} onChange={onSpeedChange}/>
                                <p className="mt-1 text-center text-[11px] text-[var(--muted)]">{SPEED_NOTE}</p>
                            </div>
                        ) : (
                            <>
                                <DayToggle days={days} day={day} onDayChange={onDayChange}/>
                                <div>
                                    <p className="text-xs font-medium text-[var(--muted)]">{hourLabel(hour)}</p>
                                    <Slider
                                        className="mt-2"
                                        value={[hour]}
                                        min={hours[0]}
                                        max={hours[hours.length - 1]}
                                        step={1}
                                        onValueChange={([v]) => onHourChange(v)}
                                        aria-label="Arrival hour"
                                    />
                                </div>
                            </>
                        )}
                        {status === 'error' && (
                            <p className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                                {bike ? "Couldn't load bike data" : `Couldn't load ${dayLabel} ${pad(hour)}:00 data`}
                                <button type="button" onClick={onRetry} className="font-semibold underline">Retry</button>
                            </p>
                        )}
                        {filters}
                    </div>

                    {children ?? (
                        <>
                            <div className="mt-4">
                                <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Showing areas within</p>
                                <Value minutes={minutes} size="lg"/>
                            </div>
                            <Slider
                                className="mt-4"
                                value={[minutes]}
                                min={times[0]}
                                max={times[times.length - 1]}
                                step={5}
                                onValueChange={([v]) => onMinutesChange(v)}
                                aria-label="Maximum travel time in minutes"
                            />
                            <div className="mt-5">
                                <Legend times={times} minutes={minutes}/>
                            </div>
                        </>
                    )}
                    <footer className="mt-4 border-t pt-3 text-[11px] leading-relaxed text-[var(--muted)]">
                        <a
                            href="https://github.com/SrzStephen/PerthMap"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-[var(--accent)] hover:underline"
                        >
                            About
                        </a>
                        {' · '}Data: Transperth GTFS, © OpenStreetMap, © Esri, intake areas © Dept of Education WA (CC BY 4.0)
                    </footer>
                </>
            )}
        </section>
    )
}
