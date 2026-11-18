import {useState, type FormEvent} from 'react'
import {LoaderCircle, Search} from 'lucide-react'
import {geocode, type Place} from '../../lib/geocode'

interface AddressSearchProps {
    onSelect: (place: Place) => void
    search?: (q: string) => Promise<Place[]>
}

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'results'; places: Place[] } | { kind: 'none' } | { kind: 'error' }

export function AddressSearch({onSelect, search = q => geocode(q)}: AddressSearchProps) {
    const [q, setQ] = useState('')
    const [state, setState] = useState<State>({kind: 'idle'})

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        const query = q.trim()
        if (!query || state.kind === 'busy') return
        setState({kind: 'busy'})
        try {
            const places = await search(query)
            if (places.length === 1) {
                setState({kind: 'idle'})
                onSelect(places[0])
            } else setState(places.length ? {kind: 'results', places} : {kind: 'none'})
        } catch (err) {
            console.error('address search', err)
            setState({kind: 'error'})
        }
    }

    const pick = (p: Place) => {
        setState({kind: 'idle'})
        onSelect(p)
    }

    return (
        <form role="search" onSubmit={submit} className="mt-3">
            <div className="flex items-center gap-1 rounded-lg border bg-white/70 px-2 focus-within:border-teal-700">
                <input type="search" role="searchbox" aria-label="Search an address" value={q}
                       onChange={e => setQ(e.target.value)} placeholder="Search an address"
                       className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"/>
                <button type="submit" aria-label="Search" className="p-1 text-[var(--muted)]">
                    {state.kind === 'busy' ? <LoaderCircle size={14} className="animate-spin"/> : <Search size={14}/>}
                </button>
            </div>
            {state.kind === 'results' && (
                <ul className="mt-1 rounded-lg border bg-white text-sm">
                    {state.places.map(p => (
                        <li key={`${p.lat},${p.lng}`}>
                            <button type="button" onClick={() => pick(p)}
                                    className="w-full px-2 py-1.5 text-left hover:bg-slate-900/5">{p.label}</button>
                        </li>
                    ))}
                </ul>
            )}
            {state.kind === 'none' && <p className="mt-1 text-xs text-amber-800">No match in the mapped area</p>}
            {state.kind === 'error' && <p className="mt-1 text-xs text-red-800">Search unavailable</p>}
            <p className="mt-1 text-[10px] text-[var(--muted)]">Search © OpenStreetMap contributors (Nominatim)</p>
        </form>
    )
}
