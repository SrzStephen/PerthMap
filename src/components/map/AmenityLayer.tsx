import {useMemo} from 'react'
import L from 'leaflet'
import {CircleMarker, Pane, Tooltip} from 'react-leaflet'
import {AMENITY_COLOURS, AMENITY_SINGULAR, type AmenityData} from '../../lib/amenities'

interface AmenityLayerProps {
    data: AmenityData
    /** Amenity type ids to draw. */
    selected: string[]
}

/** One dot per place of the selected types; hover for its name. Canvas-drawn: parks alone are ~3000 dots. */
export function AmenityLayer({data, selected}: AmenityLayerProps) {
    const renderer = useMemo(() => (typeof L.canvas === 'function' ? L.canvas({padding: 0.5, pane: 'amenities'}) : undefined), [])
    return (
        <Pane name="amenities" style={{zIndex: 380}}>
            {data.types.filter(t => selected.includes(t.id)).flatMap(t => data.byType[t.id].map((p, i) => (
                <CircleMarker key={`${t.id}-${i}`} center={[p.lat, p.lng]} radius={4} renderer={renderer}
                              pathOptions={{color: '#fff', weight: 1, fillColor: AMENITY_COLOURS[t.id] ?? '#334155', fillOpacity: 0.9}}>
                    <Tooltip direction="top" offset={[0, -4]}>{p.name || AMENITY_SINGULAR[t.id] || t.label}</Tooltip>
                </CircleMarker>
            )))}
        </Pane>
    )
}
