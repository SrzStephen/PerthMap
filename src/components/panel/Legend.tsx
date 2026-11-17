import {TIMES, bandColor} from '../../lib/bands'
import {cn} from '../../lib/utils'

const TICKS = [10, 30, 50, 70, 85]

export function Legend({minutes}: { minutes: number }) {
    return (
        <div aria-label="Colour legend, minutes to Perth CBD">
            <div className="flex h-3 gap-px overflow-hidden rounded-full">
                {TIMES.map(time => (
                    <div
                        key={time}
                        data-testid="legend-swatch"
                        data-time={time}
                        title={`${time} min`}
                        className={cn('flex-1 transition-opacity duration-200', time > minutes && 'opacity-20')}
                        style={{backgroundColor: bandColor(time)}}
                    />
                ))}
            </div>
            <div className="relative mt-1.5 h-4 text-[11px] tabular-nums text-[var(--muted)]">
                {TICKS.map(t => {
                    const pct = ((TIMES.indexOf(t) + 0.5) / TIMES.length) * 100
                    return (
                        <span key={t} className="absolute -translate-x-1/2" style={{left: `${pct}%`}}>
                            {t}
                        </span>
                    )
                })}
            </div>
        </div>
    )
}
