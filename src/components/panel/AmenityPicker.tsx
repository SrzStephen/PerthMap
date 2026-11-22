import {useState} from 'react'
import {ChevronDown, ChevronRight} from 'lucide-react'
import {AMENITY_COLOURS, type AmenityType} from '../../lib/amenities'
import {cn} from '../../lib/utils'

interface AmenityPickerProps {
    types: AmenityType[]
    /** Type ids drawn on the map. */
    selected: string[]
    onChange: (selected: string[]) => void
}

/** Toggle chips for each OpenStreetMap amenity type. */
export function AmenityPicker({types, selected, onChange}: AmenityPickerProps) {
    const [open, setOpen] = useState(false)
    const shown = types.filter(t => selected.includes(t.id)).length
    return (
        <div>
            <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
                    className="flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
                {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                Amenities{shown > 0 && ` (${shown} shown)`}
            </button>
            {open && (
                <>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {types.map(t => {
                            const on = selected.includes(t.id)
                            return (
                                <li key={t.id}>
                                    <button type="button" aria-pressed={on} aria-label={`${t.label} (${t.count})`}
                                            onClick={() => onChange(on ? selected.filter(s => s !== t.id) : [...selected, t.id])}
                                            className={cn('flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
                                                on ? 'border-slate-400 bg-white' : 'border-transparent bg-slate-900/5 text-[var(--muted)]')}>
                                        <span aria-hidden className="size-2 rounded-full"
                                              style={{background: AMENITY_COLOURS[t.id] ?? '#334155', opacity: on ? 1 : 0.5}}/>
                                        {t.label}
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">© OpenStreetMap contributors; coverage varies</p>
                </>
            )}
        </div>
    )
}
