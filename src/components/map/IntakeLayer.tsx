import {Pane, Polygon, Tooltip} from 'react-leaflet'
import {INTAKE_COLOURS, type IntakeFeature, type School} from '../../lib/schools'

interface IntakeLayerProps {
    areas: IntakeFeature[]
    /** Indexed by school number, for names and levels. */
    schools: School[]
    /** Schools chosen in the picker. */
    selected: number[]
    /** The clicked point's intake schools. */
    highlight: number[]
}

const colourOf = (s: School | undefined) => (s && s.secondary && !s.primary ? INTAKE_COLOURS.secondary : INTAKE_COLOURS.primary)

/** Intake area outlines, labelled with their school; optional (hatched on the DoE maps) areas dashed with a light fill. */
export function IntakeLayer({areas, schools, selected, highlight}: IntakeLayerProps) {
    const show = new Set([...selected, ...highlight])
    const shown = areas.filter(a => show.has(a.i))
    const labelled = new Set<number>()
    return (
        <Pane name="intake" style={{zIndex: 360}}>
            {shown.map((a, k) => {
                const s = schools[a.i]
                const color = colourOf(s)
                // one label per school, on its first main area
                const label = a.kind === 'main' && s && !labelled.has(a.i)
                if (label) labelled.add(a.i)
                return (
                    <Polygon
                        key={`${a.i}-${k}`}
                        positions={a.positions}
                        interactive={false}
                        pathOptions={a.kind === 'optional'
                            ? {color, weight: 2, dashArray: '4 4', fill: true, fillColor: color, fillOpacity: 0.1}
                            : {color, weight: 2, fill: false, fillOpacity: 0}}
                    >
                        {label && (
                            <Tooltip permanent direction="center" pane="tooltipPane" opacity={1}
                                     className={`intake-label intake-label-${color === INTAKE_COLOURS.secondary ? 'secondary' : 'primary'}`}>
                                {s.name}
                            </Tooltip>
                        )}
                    </Polygon>
                )
            })}
        </Pane>
    )
}

const Swatch = ({color, dashed = false}: { color: string; dashed?: boolean }) => (
    <svg width="22" height="10" aria-hidden className="shrink-0">
        <line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? '4 3' : undefined}/>
    </svg>
)

/** What the intake outlines mean; shown while any are on the map. */
export function IntakeLegend() {
    return (
        <section aria-label="Intake area legend"
                 className="glass absolute top-4 right-4 z-[1000] w-56 rounded-xl p-3 text-xs text-[var(--text)]">
            <h2 className="font-semibold">School intake areas</h2>
            <ul className="mt-1.5 space-y-1">
                <li className="flex items-center gap-2"><Swatch color={INTAKE_COLOURS.primary}/><span>Primary school</span></li>
                <li className="flex items-center gap-2"><Swatch color={INTAKE_COLOURS.secondary}/><span>Secondary school</span></li>
                <li className="flex items-center gap-2"><Swatch color={INTAKE_COLOURS.primary} dashed/><span>Optional area (may also enrol)</span></li>
            </ul>
            <p className="mt-1.5 text-[var(--muted)]">
                Living inside guarantees a place at that public school. Approximate — from Dept of Education maps.
            </p>
        </section>
    )
}
