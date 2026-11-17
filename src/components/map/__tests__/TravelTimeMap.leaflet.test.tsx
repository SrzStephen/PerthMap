// Uses real react-leaflet + Leaflet (no mocks) so SVG path order reflects what the browser paints.
import {describe, it, expect, vi} from 'vitest'
import {render} from '@testing-library/react'
import {TravelTimeMap} from '../TravelTimeMap'
import {bandColor} from '../../../lib/bands'

vi.mock('../../../assets/poly.json', () => {
    const square = (d: number) => [[[115.86 - d, -31.95 - d], [115.86 + d, -31.95 - d], [115.86 + d, -31.95 + d], [115.86 - d, -31.95 + d], [115.86 - d, -31.95 - d]]]
    const f = (time: number) => ({type: 'Feature', properties: {time}, geometry: {type: 'Polygon', coordinates: square(time / 1000)}})
    return {default: {type: 'FeatureCollection', features: [f(10), f(45), f(85)]}}
})

/** Fill colours of painted band paths, in SVG paint order (later = on top). */
const paintedFills = (container: HTMLElement) =>
    [...container.querySelectorAll('.leaflet-bands-pane path')]
        .map(p => p.getAttribute('fill'))
        .filter(f => f && f !== 'none')

describe('TravelTimeMap with real Leaflet', () => {
    it('paints larger bands underneath smaller ones after the slider increases', () => {
        const {container, rerender} = render(<div style={{height: 400, width: 400}}><TravelTimeMap minutes={45}/></div>)
        rerender(<div style={{height: 400, width: 400}}><TravelTimeMap minutes={85}/></div>)
        expect(paintedFills(container)).toEqual([bandColor(85), bandColor(45), bandColor(10)])
    })

    it('does not paint bands above the selected minutes', () => {
        const {container} = render(<div style={{height: 400, width: 400}}><TravelTimeMap minutes={45}/></div>)
        expect(paintedFills(container)).toEqual([bandColor(45), bandColor(10)])
    })
})
