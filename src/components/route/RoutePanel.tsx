import {useEffect} from 'react'
import {Bus, Footprints, Ship, TrainFront, X} from 'lucide-react'
import {fmtTime, isWalk, legLabel, type RouteResult, type Routes, type Stops} from '../../lib/route'

interface RoutePanelProps {
    result: RouteResult
    dayLabel: string
    routes: Routes | null
    stops: Stops | null
    onClose: () => void
}

function ModeIcon({mode}: { mode: string }) {
    const props = {size: 16, 'aria-hidden': true, className: 'mt-0.5 shrink-0 text-[var(--muted)]'}
    if (mode === 'WALK') return <Footprints {...props}/>
    if (mode === 'BUS') return <Bus {...props}/>
    if (mode === 'FERRY') return <Ship {...props}/>
    return <TrainFront {...props}/>
}

const Row = ({mode, children}: { mode: string; children: React.ReactNode }) => (
    <li className="flex gap-2 text-sm"><ModeIcon mode={mode}/><span className="flex-1">{children}</span></li>
)

export function RoutePanel({result, dayLabel, routes, stops, onClose}: RoutePanelProps) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose])

    const times = 'best' in result && <p className="text-base font-semibold">{`Best ${result.best} min · typical ${result.typical} min`}</p>

    return (
        <div className="mt-4 border-t pt-4" aria-label="Route">
            <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                    {times}
                    {result.kind === 'transit' && (
                        <p className="text-xs text-[var(--muted)]">{`Leave ${result.leave} → arrive ${result.arrive} (${dayLabel})`}</p>
                    )}
                    {result.kind === 'outside' && <p className="text-sm">Outside the mapped area</p>}
                    {result.kind === 'unreachable' && (
                        <p className="text-sm">No public transport route within 2 h (max 15 min walk to a stop)</p>
                    )}
                    {result.kind === 'missing' && <p className="text-sm text-[var(--muted)]">Route details unavailable</p>}
                </div>
                <button type="button" onClick={onClose} aria-label="Close route"
                        className="rounded-full p-1 text-[var(--muted)] hover:bg-slate-900/5">
                    <X size={16}/>
                </button>
            </div>

            {result.kind === 'walk' && (
                <ul className="mt-3 space-y-2"><Row mode="WALK">{`Walk ${result.best} min`}</Row></ul>
            )}
            {result.kind === 'transit' && routes && (
                <ul className="mt-3 space-y-2">
                    <Row mode="WALK">{`Walk ${result.walk} min to ${stops?.[result.boardStop]?.[0] ?? 'the stop'}`}</Row>
                    {result.trip[2].map((leg, i, legs) => {
                        const mode = routes.lines[leg[0]][0]
                        return (
                            <Row key={i} mode={mode}>
                                {legLabel(leg, routes, stops, i === legs.length - 1)}
                                {!isWalk(leg, routes) && (
                                    <span className="float-right tabular-nums text-xs text-[var(--muted)]">
                                        {`${fmtTime(leg[3])} – ${fmtTime(leg[4])}`}
                                    </span>
                                )}
                            </Row>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
