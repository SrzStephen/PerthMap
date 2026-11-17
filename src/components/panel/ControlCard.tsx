import {useState} from 'react'
import {ChevronDown, ChevronUp} from 'lucide-react'
import {Slider} from '../ui/slider'
import {Legend} from './Legend'
import {useIsMobile} from '../../hooks/use-mobile'
import {cn} from '../../lib/utils'

interface ControlCardProps {
    minutes: number
    onMinutesChange: (minutes: number) => void
}

const Value = ({minutes, size}: { minutes: number; size: 'lg' | 'sm' }) => (
    <span className={cn('font-semibold tabular-nums tracking-tight', size === 'lg' ? 'text-5xl' : 'text-base')}>
        <span data-testid="minutes-value">{minutes}</span>
        <span className={cn('ml-1 font-medium text-[var(--muted)]', size === 'lg' ? 'text-lg' : 'text-sm')}>min</span>
    </span>
)

export function ControlCard({minutes, onMinutesChange}: ControlCardProps) {
    const isMobile = useIsMobile()
    const [expanded, setExpanded] = useState(true)
    const open = !isMobile || expanded

    return (
        <section
            aria-label="Map controls"
            className={cn(
                'glass absolute z-[1000] rounded-2xl text-[var(--text)]',
                isMobile ? 'inset-x-4 bottom-4 p-4' : 'top-4 left-4 w-[300px] p-5',
            )}
        >
            <header className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold leading-tight tracking-tight">PerthMap</h1>
                    {open && <p className="text-sm text-[var(--muted)]">Public transport time to Perth CBD</p>}
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
                    <div className="mt-4">
                        <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Showing areas within</p>
                        <Value minutes={minutes} size="lg"/>
                    </div>
                    <Slider
                        className="mt-4"
                        value={[minutes]}
                        min={10}
                        max={85}
                        step={5}
                        onValueChange={([v]) => onMinutesChange(v)}
                        aria-label="Maximum travel time in minutes"
                    />
                    <div className="mt-5">
                        <Legend minutes={minutes}/>
                    </div>
                    <footer className="mt-4 border-t pt-3 text-[11px] leading-relaxed text-[var(--muted)]">
                        <a
                            href="https://github.com/SrzStephen/PerthMap"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-[var(--accent)] hover:underline"
                        >
                            About
                        </a>
                        {' · '}Data: Transperth GTFS, © OpenStreetMap, © CARTO
                    </footer>
                </>
            )}
        </section>
    )
}
