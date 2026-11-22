// Uses real react-leaflet + Leaflet (no mocks) so SVG path order reflects what the browser paints.
import {describe, it, expect} from 'vitest'
import {render} from '@testing-library/react'
import {TravelTimeMap} from '../TravelTimeMap'
import {bandColor, type Band} from '../../../lib/bands'

const square = (time: number): Band => {
    const d = time / 1000
    return {time, positions: [[[[-31.95 - d, 115.86 - d], [-31.95 - d, 115.86 + d], [-31.95 + d, 115.86 + d], [-31.95 + d, 115.86 - d]]]]}
}
const BANDS = [square(85), square(45), square(15)]

/** Fill colours of painted band paths, in SVG paint order (later = on top). */
const paintedFills = (container: HTMLElement) =>
    [...container.querySelectorAll('.leaflet-bands-pane path')]
        .map(p => p.getAttribute('fill'))
        .filter(f => f && f !== 'none')

const Map = ({minutes, bands = BANDS}: { minutes: number; bands?: Band[] }) =>
    <div style={{height: 400, width: 400}}><TravelTimeMap minutes={minutes} bands={bands}/></div>

describe('TravelTimeMap with real Leaflet', () => {
    it('paints larger bands underneath smaller ones after the slider increases', () => {
        const {container, rerender} = render(<Map minutes={45}/>)
        rerender(<Map minutes={85}/>)
        expect(paintedFills(container)).toEqual([bandColor(85), bandColor(45), bandColor(15)])
    })

    it('does not paint bands above the selected minutes', () => {
        const {container} = render(<Map minutes={45}/>)
        expect(paintedFills(container)).toEqual([bandColor(45), bandColor(15)])
    })

    it('keeps largest-first paint order when a new window replaces the bands', () => {
        const {container, rerender} = render(<Map minutes={85} bands={[square(45), square(15)]}/>)
        rerender(<Map minutes={85}/>)
        expect(paintedFills(container)).toEqual([bandColor(85), bandColor(45), bandColor(15)])
    })
})
