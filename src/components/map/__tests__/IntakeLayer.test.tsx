import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import type {ReactNode} from 'react'
import {IntakeLayer, IntakeLegend} from '../IntakeLayer'
import {INTAKE_COLOURS, type IntakeFeature, type School} from '../../../lib/schools'

vi.mock('react-leaflet', () => ({
    Pane: ({children}: { children?: ReactNode }) => <div>{children}</div>,
    Polygon: ({pathOptions, children}: { pathOptions: { color: string; dashArray?: string; fillOpacity?: number }; children?: ReactNode }) =>
        <div data-testid="area" data-color={pathOptions.color} data-dash={pathOptions.dashArray ?? ''}
             data-fill={pathOptions.fillOpacity}>{children}</div>,
    Tooltip: ({children, className}: { children?: ReactNode; className?: string }) =>
        <span data-testid="label" className={className}>{children}</span>,
}))

const ring: [number, number][][][] = [[[[0, 0], [0, 1], [1, 0], [0, 0]]]]
const AREAS: IntakeFeature[] = [
    {i: 0, kind: 'main', positions: ring},
    {i: 0, kind: 'optional', positions: ring},
    {i: 1, kind: 'main', positions: ring},
    {i: 2, kind: 'main', positions: ring},
]
const school = (index: number, name: string, primary: boolean, secondary: boolean): School =>
    ({index, code: String(index), name, primary, secondary, lat: 0, lon: 0, hasIntake: true})
const SCHOOLS = [school(0, 'Wembley Primary School', true, false), school(1, 'Churchlands Senior High School', false, true),
    school(2, 'Mindarie College', true, true)]

const areas = () => screen.queryAllByTestId('area').map(a => ({
    color: a.dataset.color, dashed: a.dataset.dash !== '', fill: Number(a.dataset.fill),
}))

describe('IntakeLayer', () => {
    it('draws the selected and highlighted schools only, optional areas dashed', () => {
        render(<IntakeLayer areas={AREAS} schools={SCHOOLS} selected={[0]} highlight={[2]}/>)
        expect(areas()).toEqual([
            {color: INTAKE_COLOURS.primary, dashed: false, fill: 0},
            {color: INTAKE_COLOURS.primary, dashed: true, fill: 0.1},
            {color: INTAKE_COLOURS.primary, dashed: false, fill: 0},
        ])
    })

    it('colours secondary schools differently', () => {
        render(<IntakeLayer areas={AREAS} schools={SCHOOLS} selected={[1]} highlight={[]}/>)
        expect(areas()).toEqual([{color: INTAKE_COLOURS.secondary, dashed: false, fill: 0}])
        expect(INTAKE_COLOURS.secondary).not.toBe(INTAKE_COLOURS.primary)
    })

    it('labels each main area with its school', () => {
        render(<IntakeLayer areas={AREAS} schools={SCHOOLS} selected={[0, 1]} highlight={[]}/>)
        expect(screen.getAllByTestId('label').map(l => l.textContent)).toEqual([
            'Wembley Primary School', 'Churchlands Senior High School',
        ])
        expect(screen.getAllByTestId('label').map(l => l.className)).toEqual([
            'intake-label intake-label-primary', 'intake-label intake-label-secondary',
        ])
    })

    it('draws nothing with nothing selected or highlighted', () => {
        render(<IntakeLayer areas={AREAS} schools={SCHOOLS} selected={[]} highlight={[]}/>)
        expect(areas()).toEqual([])
    })
})

describe('IntakeLegend', () => {
    it('explains the outlines', () => {
        render(<IntakeLegend/>)
        expect(screen.getByRole('heading', {name: 'School intake areas'})).toBeInTheDocument()
        expect(screen.getByText('Primary school')).toBeInTheDocument()
        expect(screen.getByText('Secondary school')).toBeInTheDocument()
        expect(screen.getByText('Optional area (may also enrol)')).toBeInTheDocument()
        expect(screen.getByText(/Living inside guarantees a place/)).toBeInTheDocument()
    })
})
