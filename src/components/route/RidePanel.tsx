import {useEffect} from 'react'
import {X} from 'lucide-react'
import type {RideResult} from '../../lib/bike'
import {ElevationProfile} from './ElevationProfile'

interface RidePanelProps {
    result: RideResult
    onClose: () => void
}

export function RidePanel({result, onClose}: RidePanelProps) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose])

    const hasTime = result.kind === 'ride' || result.kind === 'missing'
    return (
        <div className="mt-4 border-t pt-4" aria-label="Route">
            <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                    {hasTime && (
                        <p className="text-base font-semibold">
                            {`Ride ${result.minutes} min · ${(result.metres / 1000).toFixed(1)} km at ${result.speed} km/h`}
                        </p>
                    )}
                    {result.kind === 'outside' && <p className="text-sm">Outside the mapped area</p>}
                    {result.kind === 'unreachable' && <p className="text-sm">No bike route within 3 h</p>}
                    {result.kind === 'missing' && <p className="text-sm text-[var(--muted)]">Route details unavailable</p>}
                </div>
                <button type="button" onClick={onClose} aria-label="Close route"
                        className="rounded-full p-1 text-[var(--muted)] hover:bg-slate-900/5">
                    <X size={16}/>
                </button>
            </div>
            {result.kind === 'ride' && result.profile && (
                <>
                    <ElevationProfile points={result.profile}/>
                    {result.ascent !== null && result.descent !== null && (
                        <p className="mt-1 text-xs tabular-nums text-[var(--muted)]">{`↑ ${result.ascent} m  ↓ ${result.descent} m`}</p>
                    )}
                </>
            )}
        </div>
    )
}
