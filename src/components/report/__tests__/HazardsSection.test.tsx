import {describe, expect, it} from 'vitest'
import {render, screen} from '@testing-library/react'
import {HazardsSection, type AttrsState} from '../HazardsSection'
import type {AttrData, LayerInfo} from '../../../lib/attrs'

const layer = (id: string, field: string, source: string, local = false): LayerInfo =>
    ({id, field, title: id, source, licence: 'l', url: 'u', asOf: '2026-11-22', local})
const PUBLIC = [layer('bushfire', 'bushfire', 'OBRM-026'), layer('traffic', 'traffic_k', 'Main Roads Traffic Digest'),
    layer('power', 'power_m', 'OpenStreetMap')]
const LOCAL = [layer('acid', 'acid', 'DWER-055', true), layer('noise', 'noise', 'DPLH-057', true)]

function state(values: Record<string, number>, {local = true, status = 'ok'}: { local?: boolean; status?: AttrData['localStatus'] } = {}): AttrsState {
    const layers = local ? [...PUBLIC, ...LOCAL] : PUBLIC
    const fields = Object.fromEntries(layers.map(l => [l.field, new Uint8Array(1)]))
    return {values, data: {fields, layers, localStatus: status}}
}

const ALL = {bushfire: 1, traffic_k: 25, power_m: 184, acid: 1, noise: 3}

describe('HazardsSection', () => {
    it('describes every layer at the point', () => {
        render(<HazardsSection attrs={state(ALL)} local/>)
        expect(screen.getByRole('heading', {name: 'Hazards'})).toBeInTheDocument()
        expect(screen.getByRole('heading', {name: 'Noise & nuisances'})).toBeInTheDocument()
        for (const text of ['Bushfire prone area', 'Acid sulfate soils: high to moderate risk',
            'Busiest road within 200 m: ~25,000 vehicles/day', 'In a road/rail noise area (Freight railway)',
            'Powerline or substation 180 m away']) {
            expect(screen.getByText(text)).toBeInTheDocument()
        }
        expect(screen.getByText('OBRM-026 · as of 2026-11-22')).toBeInTheDocument()
    })

    it('words the all-clear values', () => {
        render(<HazardsSection attrs={state({bushfire: 0, traffic_k: 0, power_m: 5000, acid: 0, noise: 0})} local/>)
        for (const text of ['Not bushfire prone', 'Acid sulfate soils: no mapped risk', 'No counted busy road within 200 m',
            'Outside road/rail noise areas', 'No powerline or substation within 5 km']) {
            expect(screen.getByText(text)).toBeInTheDocument()
        }
    })

    it('words moderate to low acid sulfate risk', () => {
        render(<HazardsSection attrs={state({...ALL, acid: 2})} local/>)
        expect(screen.getByText('Acid sulfate soils: moderate to low risk')).toBeInTheDocument()
    })

    it('points a public build at PlanWA for local-only layers', () => {
        const {bushfire, traffic_k, power_m} = ALL
        render(<HazardsSection attrs={state({bushfire, traffic_k, power_m}, {local: false, status: 'off'})} local={false}/>)
        expect(screen.getByText(/Acid sulfate soils: local build only/)).toBeInTheDocument()
        expect(screen.getByText(/Road\/rail noise areas: local build only/)).toBeInTheDocument()
        expect(screen.getAllByRole('link', {name: 'PlanWA'})[0])
            .toHaveAttribute('href', 'https://espatial.dplh.wa.gov.au/PlanWA/Index.html?viewer=PlanWA')
    })

    it('says when a local build has no local data', () => {
        const {bushfire, traffic_k, power_m} = ALL
        render(<HazardsSection attrs={state({bushfire, traffic_k, power_m}, {local: false, status: 'missing'})} local/>)
        expect(screen.getByText('Acid sulfate soils: Local data not found — run the hazards stage')).toBeInTheDocument()
    })

    it('shows loading and error states', () => {
        const {rerender} = render(<HazardsSection attrs="loading" local/>)
        expect(screen.getByText('Loading hazards…')).toBeInTheDocument()
        rerender(<HazardsSection attrs="error" local/>)
        expect(screen.getByText('Hazard data unavailable')).toBeInTheDocument()
    })
})
