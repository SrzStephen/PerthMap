import {bandColor, legendTicks} from '../../lib/bands'
import {cn} from '../../lib/utils'

export function Legend({times, minutes}: { times: number[]; minutes: number }) {
    return (
        <div aria-label="Colour legend, minutes to Perth CBD">
            <div className="flex h-3 gap-px overflow-hidden rounded-full">
                {times.map(time => (
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
                {legendTicks(times).map(t => {
                    const pct = ((times.indexOf(t) + 0.5) / times.length) * 100
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
