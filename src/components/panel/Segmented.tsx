import {cn} from '../../lib/utils'

interface SegmentedProps<T extends string | number> {
    label: string
    options: { value: T; label: string }[]
    value: T
    onChange: (value: T) => void
}

/** Pill-style radio group (day, mode, speed). */
export function Segmented<T extends string | number>({label, options, value, onChange}: SegmentedProps<T>) {
    return (
        <div role="radiogroup" aria-label={label} className="flex rounded-full bg-slate-900/5 p-0.5 text-xs font-medium">
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={o.value === value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'flex-1 rounded-full px-2 py-1 transition-colors',
                        o.value === value ? 'bg-white text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]',
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
}
