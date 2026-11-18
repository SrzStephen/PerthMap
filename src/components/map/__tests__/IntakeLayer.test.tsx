import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import type {ReactNode} from 'react'
import {IntakeLayer} from '../IntakeLayer'
import type {IntakeFeature} from '../../../lib/schools'

vi.mock('react-leaflet', () => ({
    Pane: ({children}: { children?: ReactNode }) => <div>{children}</div>,
    Polygon: ({pathOptions}: { pathOptions: { dashArray?: string; fillOpacity?: number } }) =>
        <div data-testid="area" data-dash={pathOptions.dashArray ?? ''} data-fill={pathOptions.fillOpacity}/>,
}))

const ring: [number, number][][][] = [[[[0, 0], [0, 1], [1, 0], [0, 0]]]]
const AREAS: IntakeFeature[] = [
    {i: 0, kind: 'main', positions: ring},
    {i: 0, kind: 'optional', positions: ring},
    {i: 1, kind: 'main', positions: ring},
    {i: 2, kind: 'main', positions: ring},
]
const areas = () => screen.queryAllByTestId('area').map(a => ({dashed: a.dataset.dash !== '', fill: Number(a.dataset.fill)}))

describe('IntakeLayer', () => {
    it('draws the selected and highlighted schools only, optional areas dashed', () => {
        render(<IntakeLayer areas={AREAS} selected={[0]} highlight={[2]}/>)
        expect(areas()).toEqual([
            {dashed: false, fill: 0},
            {dashed: true, fill: 0.1},
            {dashed: false, fill: 0},
        ])
    })

    it('draws nothing with nothing selected or highlighted', () => {
        render(<IntakeLayer areas={AREAS} selected={[]} highlight={[]}/>)
        expect(areas()).toEqual([])
    })
})
