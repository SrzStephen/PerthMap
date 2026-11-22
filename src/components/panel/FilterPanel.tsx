import {useState} from 'react'
import {ChevronDown, ChevronRight, Eye, EyeOff} from 'lucide-react'
import type {LayerInfo} from '../../lib/attrs'
import type {ActiveFilters, FilterDef} from '../../lib/filters'
import {cn} from '../../lib/utils'

export const EMPTY_FILTERS = 'No mapped area passes the selected filters'

interface FilterPanelProps {
    /** Layers whose field is loaded. */
    layers: LayerInfo[]
    /** Filters whose field is loaded. */
    filters: FilterDef[]
    active: ActiveFilters
    onChange: (active: ActiveFilters) => void
    /** Layer ids drawn on the map. */
    shown: string[]
    onShownChange: (shown: string[]) => void
    /** Active filters (with any school selection) leave no mapped cell. */
    empty: boolean
}

const without = (active: ActiveFilters, id: string) => Object.fromEntries(Object.entries(active).filter(([k]) => k !== id))

/** Hazard and noise layers: tick to limit the map to cells that pass, eye to draw the layer. */
export function FilterPanel({layers, filters, active, onChange, shown, onShownChange, empty}: FilterPanelProps) {
    const [open, setOpen] = useState(false)
    const count = Object.keys(active).filter(id => filters.some(f => f.id === id)).length

    return (
        <div>
            <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
                    className="flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
                {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                Hazards & noise{count > 0 && ` (${count} on)`}
            </button>
            {open && (
                <ul className="mt-1 space-y-1.5">
                    {layers.map(layer => {
                        const f = filters.find(d => d.field === layer.field)
                        const on = !!f && f.id in active
                        const visible = shown.includes(layer.id)
                        return (
                            <li key={layer.id} className="flex items-center gap-2 text-sm">
                                <button type="button" aria-pressed={visible} aria-label={`Show ${layer.title}`}
                                        title={`Show ${layer.title}`}
                                        onClick={() => onShownChange(visible ? shown.filter(s => s !== layer.id) : [...shown, layer.id])}
                                        className={cn('rounded p-0.5 hover:bg-slate-900/5', visible ? 'text-teal-700' : 'text-[var(--muted)]')}>
                                    {visible ? <Eye size={14}/> : <EyeOff size={14}/>}
                                </button>
                                {f ? (
                                    <label className="flex flex-1 items-center gap-1.5">
                                        <input type="checkbox" checked={on}
                                               onChange={() => onChange(on ? without(active, f.id)
                                                   : {...active, [f.id]: f.defaultThreshold ?? 0})}/>
                                        {f.label}
                                    </label>
                                ) : <span className="flex-1">{layer.title}</span>}
                                {f?.thresholds && (
                                    <select aria-label={`${f.label} threshold`} value={active[f.id] ?? f.defaultThreshold}
                                            onChange={e => onChange({...active, [f.id]: Number(e.target.value)})}
                                            className="rounded border bg-white/70 px-1 py-0.5 text-xs">
                                        {f.thresholds.map(t => <option key={t} value={t}>{`${t}${f.unit ?? ''}`}</option>)}
                                    </select>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
            {empty && count > 0 && <p className="mt-2 text-xs text-amber-800">{EMPTY_FILTERS}</p>}
        </div>
    )
}
