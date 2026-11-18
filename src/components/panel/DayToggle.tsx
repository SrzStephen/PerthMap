import type {DataIndex, DayKey} from '../../lib/grid'
import {cn} from '../../lib/utils'

interface DayToggleProps {
    days: DataIndex['days']
    day: DayKey
    onDayChange: (day: DayKey) => void
}

export function DayToggle({days, day, onDayChange}: DayToggleProps) {
    return (
        <div role="radiogroup" aria-label="Day" className="flex rounded-full bg-slate-900/5 p-0.5 text-xs font-medium">
            {days.map(d => (
                <button
                    key={d.key}
                    type="button"
                    role="radio"
                    aria-checked={d.key === day}
                    onClick={() => onDayChange(d.key)}
                    className={cn(
                        'flex-1 rounded-full px-2 py-1 transition-colors',
                        d.key === day ? 'bg-white text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]',
                    )}
                >
                    {d.label}
                </button>
            ))}
        </div>
    )
}
