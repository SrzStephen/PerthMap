import type {ReactNode} from 'react'
import type {AttrData} from '../../lib/attrs'
import {LOCAL_LAYERS, PLANWA} from '../../lib/local'

export type AttrsState = { values: Record<string, number>; data: AttrData } | 'loading' | 'error' | null

/** SPP 5.4 route types, in the order data_gen/hazards.py numbers them (value - 1). */
const NOISE_TYPES = ['Strategic freight and/or major traffic route', 'Other significant freight/traffic route',
    'Freight railway', 'Metropolitan passenger railway', 'Proposed strategic freight route',
    'Proposed metropolitan passenger railway']
const LOCAL_TITLES: Record<string, string> = {acid: 'Acid sulfate soils', noise: 'Road/rail noise areas'}
const POWER_CAP_M = 5000

const DESCRIBE: Record<string, (v: number) => string> = {
    bushfire: v => (v ? 'Bushfire prone area' : 'Not bushfire prone'),
    acid: v => (v === 1 ? 'Acid sulfate soils: high to moderate risk'
        : v === 2 ? 'Acid sulfate soils: moderate to low risk' : 'Acid sulfate soils: no mapped risk'),
    traffic: v => (v ? `Busiest road within 200 m: ~${v},000 vehicles/day` : 'No counted busy road within 200 m'),
    noise: v => (v ? `In a road/rail noise area (${NOISE_TYPES[v - 1] ?? 'unknown route type'})` : 'Outside road/rail noise areas'),
    power: v => (v >= POWER_CAP_M ? 'No powerline or substation within 5 km' : `Powerline or substation ${Math.round(v / 10) * 10} m away`),
}

const SECTIONS: [string, string[]][] = [['Hazards', ['bushfire', 'acid']], ['Noise & nuisances', ['traffic', 'noise', 'power']]]

const Muted = ({children}: { children: ReactNode }) => <p className="text-xs text-[var(--muted)]">{children}</p>

function Row({id, values, data, local}: { id: string; values: Record<string, number>; data: AttrData; local: boolean }) {
    const layer = data.layers.find(l => l.id === id)
    if (layer && layer.field in values) {
        return (
            <li className="text-sm">
                <p>{DESCRIBE[id](values[layer.field])}</p>
                <Muted>{`${layer.source} · as of ${layer.asOf}`}</Muted>
            </li>
        )
    }
    const title = LOCAL_TITLES[id]
    if (!title) return null
    return (
        <li className="text-sm text-[var(--muted)]">
            {local ? `${title}: Local data not found — run the hazards stage` : (
                <>{`${title}: local build only`} · <a href={PLANWA} target="_blank" rel="noreferrer" className="underline">PlanWA</a></>
            )}
        </li>
    )
}

/** Hazard, noise and nuisance facts for the clicked cell. */
export function HazardsSection({attrs, local = LOCAL_LAYERS}: { attrs: AttrsState; local?: boolean }) {
    if (attrs === null) return null
    if (typeof attrs === 'string') {
        return (
            <section className="mt-4 border-t pt-4" aria-label="Hazards">
                <p className="text-sm text-[var(--muted)]">{attrs === 'loading' ? 'Loading hazards…' : 'Hazard data unavailable'}</p>
            </section>
        )
    }
    return (
        <>
            {SECTIONS.map(([heading, ids]) => (
                <section key={heading} className="mt-4 border-t pt-4" aria-label={heading}>
                    <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{heading}</h3>
                    <ul className="mt-2 space-y-2">
                        {ids.map(id => <Row key={id} id={id} values={attrs.values} data={attrs.data} local={local}/>)}
                    </ul>
                </section>
            ))}
        </>
    )
}
