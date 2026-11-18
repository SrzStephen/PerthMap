import {useMemo, useState} from 'react'
import {X} from 'lucide-react'
import type {School} from '../../lib/schools'

interface SchoolPickerProps {
    schools: School[]
    /** School indices whose intake areas limit the map. */
    selected: number[]
    onChange: (selected: number[]) => void
    /** The selection covers no mapped cell. */
    empty: boolean
}

const MAX_RESULTS = 8
const levelLabel = (s: School) => (s.primary && s.secondary ? 'K–12' : s.primary ? 'Primary' : 'Secondary')

export function SchoolPicker({schools, selected, onChange, empty}: SchoolPickerProps) {
    const [query, setQuery] = useState('')
    const matches = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return []
        return schools.filter(s => s.hasIntake && !selected.includes(s.index) && s.name.toLowerCase().includes(q))
            .slice(0, MAX_RESULTS)
    }, [query, schools, selected])

    return (
        <div>
            <label className="text-xs font-medium text-[var(--muted)]" htmlFor="school-picker">
                Limit to school intake areas
            </label>
            <input
                id="school-picker" type="search" role="searchbox" aria-label="Find a school" value={query}
                onChange={e => setQuery(e.target.value)} placeholder="Find a school"
                className="mt-1 w-full rounded-lg border bg-white/70 px-2 py-1.5 text-sm outline-none focus:border-teal-700"
            />
            {matches.length > 0 && (
                <ul role="listbox" aria-label="Schools" className="mt-1 max-h-48 overflow-y-auto rounded-lg border bg-white">
                    {matches.map(s => (
                        <li key={s.index} role="option" aria-selected={false} tabIndex={0}
                            onClick={() => { onChange([...selected, s.index]); setQuery('') }}
                            onKeyDown={e => { if (e.key === 'Enter') { onChange([...selected, s.index]); setQuery('') } }}
                            className="flex cursor-pointer justify-between gap-2 px-2 py-1.5 text-sm hover:bg-slate-900/5">
                            <span>{s.name}</span>
                            <span className="text-xs text-[var(--muted)]">{levelLabel(s)}</span>
                        </li>
                    ))}
                </ul>
            )}
            {selected.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Selected schools">
                    {selected.map(i => schools[i]).filter(Boolean).map(s => (
                        <li key={s.index} className="flex items-center gap-1 rounded-full bg-teal-700/10 py-0.5 pl-2 pr-1 text-xs text-teal-900">
                            {s.name}
                            <button type="button" aria-label={`Remove ${s.name}`}
                                    onClick={() => onChange(selected.filter(x => x !== s.index))}
                                    className="rounded-full p-0.5 hover:bg-teal-700/20">
                                <X size={12}/>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {empty && selected.length > 0 && (
                <p className="mt-2 text-xs text-amber-800">Selected intake areas are outside the mapped area</p>
            )}
        </div>
    )
}
