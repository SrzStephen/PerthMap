import {afterEach, describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import type {ReactNode} from 'react'
import {LineLayer} from '../LineLayer'

vi.mock('react-leaflet', () => ({
    Pane: ({children}: { children?: ReactNode }) => <div>{children}</div>,
    Polyline: ({pathOptions}: { pathOptions: { weight: number } }) => <div data-testid="line" data-weight={pathOptions.weight}/>,
    CircleMarker: () => <div data-testid="point"/>,
}))

const FC = {type: 'FeatureCollection', features: [
    {type: 'Feature', properties: {kind: 'line', k: 40}, geometry: {type: 'LineString', coordinates: [[115, -32], [115.1, -32]]}},
    {type: 'Feature', properties: {kind: 'line', k: 10}, geometry: {type: 'MultiLineString', coordinates: [[[115, -32], [115.1, -32]], [[115, -31.9], [115.1, -31.9]]]}},
    {type: 'Feature', properties: {kind: 'substation'}, geometry: {type: 'Point', coordinates: [115.05, -32]}},
]}

afterEach(() => vi.unstubAllGlobals())

describe('LineLayer', () => {
    it('draws lines and points from its file', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(FC))))
        render(<LineLayer file="test-lines.json" colour="#123" weight={p => (p.k as number) / 10}/>)
        expect(await screen.findAllByTestId('line')).toHaveLength(3)
        expect(screen.getAllByTestId('point')).toHaveLength(1)
        expect(screen.getAllByTestId('line').map(l => l.dataset.weight)).toEqual(['4', '1', '1'])
    })

    it('draws nothing when the file fails', async () => {
        const fetch = vi.fn(async () => new Response('', {status: 404}))
        vi.stubGlobal('fetch', fetch)
        render(<LineLayer file="missing.json" colour="#123"/>)
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
        expect(screen.queryAllByTestId('line')).toHaveLength(0)
    })
})
