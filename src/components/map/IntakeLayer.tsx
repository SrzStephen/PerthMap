import {Pane, Polygon} from 'react-leaflet'
import type {IntakeFeature} from '../../lib/schools'

interface IntakeLayerProps {
    areas: IntakeFeature[]
    /** Schools chosen in the picker. */
    selected: number[]
    /** The clicked point's intake schools. */
    highlight: number[]
}

const COLOR = '#0f766e'

/** Intake area outlines; optional (hatched on the DoE maps) areas dashed with a light fill. */
export function IntakeLayer({areas, selected, highlight}: IntakeLayerProps) {
    const show = new Set([...selected, ...highlight])
    const shown = areas.filter(a => show.has(a.i))
    return (
        <Pane name="intake" style={{zIndex: 360}}>
            {shown.map((a, k) => (
                <Polygon
                    key={`${a.i}-${k}`}
                    positions={a.positions}
                    interactive={false}
                    pathOptions={a.kind === 'optional'
                        ? {color: COLOR, weight: 2, dashArray: '4 4', fill: true, fillColor: COLOR, fillOpacity: 0.1}
                        : {color: COLOR, weight: 2, fill: false, fillOpacity: 0}}
                />
            ))}
        </Pane>
    )
}
