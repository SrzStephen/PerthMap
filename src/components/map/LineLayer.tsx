import {useEffect, useState} from 'react'
import {CircleMarker, Pane, Polyline} from 'react-leaflet'
import {fetchJson} from '../../lib/grid'

type Props = Record<string, unknown>

interface LineFeature {
    properties: Props
    geometry: { type: string; coordinates: unknown } | null
}

interface Shape {
    props: Props
    lines: [number, number][][]
    point: [number, number] | null
}

const files = new Map<string, Promise<Shape[]>>()
const flip = (c: number[]) => [c[1], c[0]] as [number, number]

function shapes(fc: { features: LineFeature[] }): Shape[] {
    return fc.features.flatMap((f): Shape[] => {
        const g = f.geometry
        if (!g) return []
        if (g.type === 'LineString') return [{props: f.properties, lines: [(g.coordinates as number[][]).map(flip)], point: null}]
        if (g.type === 'MultiLineString') {
            return [{props: f.properties, lines: (g.coordinates as number[][][]).map(l => l.map(flip)), point: null}]
        }
        if (g.type === 'Point') return [{props: f.properties, lines: [], point: flip(g.coordinates as number[])}]
        return []
    })
}

function load(file: string): Promise<Shape[]> {
    let p = files.get(file)
    if (!p) {
        p = fetchJson<{ features: LineFeature[] }>(file).then(shapes)
        p.catch(() => files.delete(file))
        files.set(file, p)
    }
    return p
}

interface LineLayerProps {
    /** GeoJSON file in public/data. */
    file: string
    colour: string
    /** Line weight per feature (default 2). */
    weight?: (props: Props) => number
}

/** Lines (and points, e.g. substations) from a small GeoJSON file, fetched the first time it is shown. */
export function LineLayer({file, colour, weight}: LineLayerProps) {
    const [data, setData] = useState<Shape[]>([])
    useEffect(() => {
        let live = true
        load(file).then(d => live && setData(d), e => console.error(`loading ${file}`, e))
        return () => {
            live = false
        }
    }, [file])
    return (
        <Pane name={`lines-${file.replace(/\W/g, '-')}`} style={{zIndex: 370}}>
            {data.flatMap((s, i) => [
                ...s.lines.map((line, j) => (
                    <Polyline key={`${i}-${j}`} positions={line} interactive={false}
                              pathOptions={{color: colour, weight: weight ? weight(s.props) : 2, opacity: 0.8}}/>
                )),
                ...(s.point ? [<CircleMarker key={`${i}-p`} center={s.point} radius={4} interactive={false}
                                             pathOptions={{color: colour, weight: 1, fillOpacity: 0.6}}/>] : []),
            ])}
        </Pane>
    )
}
