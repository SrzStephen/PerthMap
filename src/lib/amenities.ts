/** Everyday amenities from OpenStreetMap. Format: data_gen/README.md (`amenities.json`). */
import {fetchJson} from './grid'

export interface Place {
    lat: number
    lng: number
    /** "" when OSM has no name. */
    name: string
}

export interface AmenityType {
    id: string
    label: string
    count: number
}

export interface AmenityData {
    asOf: string
    source: string
    types: AmenityType[]
    byType: Record<string, Place[]>
}

interface AmenitiesJson {
    asOf: string
    source: string
    types: string[][]
    items: (string | number)[][]
}

export const AMENITY_COLOURS: Record<string, string> = {
    supermarket: '#16a34a', park: '#65a30d', playground: '#ca8a04', station: '#0369a1', gp: '#dc2626',
    pharmacy: '#db2777', hospital: '#991b1b', childcare: '#ea580c', library: '#7c3aed', cafe: '#92400e',
}

/** What to call an unnamed place of each type. */
export const AMENITY_SINGULAR: Record<string, string> = {
    supermarket: 'Supermarket', park: 'Park', playground: 'Playground', station: 'Train station', gp: 'GP',
    pharmacy: 'Pharmacy', hospital: 'Hospital', childcare: 'Childcare', library: 'Library', cafe: 'Café',
}

export function parseAmenities(j: AmenitiesJson): AmenityData {
    const byType: Record<string, Place[]> = Object.fromEntries(j.types.map(([id]) => [id, []]))
    for (const [t, lat, lng, name] of j.items) {
        const id = j.types[t as number]?.[0]
        if (id) byType[id].push({lat: lat as number, lng: lng as number, name: String(name ?? '')})
    }
    return {asOf: j.asOf, source: j.source, byType,
        types: j.types.map(([id, label]) => ({id, label, count: byType[id].length}))}
}

let cache: Promise<AmenityData> | null = null

/** Loaded once; a failed load is forgotten so it can be retried. */
export function loadAmenities(): Promise<AmenityData> {
    if (!cache) {
        cache = fetchJson<AmenitiesJson>('amenities.json').then(parseAmenities)
        cache.catch(() => (cache = null))
    }
    return cache
}

export const clearAmenitiesCache = () => void (cache = null)
