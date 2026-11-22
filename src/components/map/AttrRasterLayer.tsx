import {useMemo} from 'react'
import {ImageOverlay, Pane} from 'react-leaflet'
import type {Plane} from '../../lib/attrs'
import type {GridMeta} from '../../lib/grid'
import {rasterBounds, rasterPixels, type RGBA} from '../../lib/raster'

interface AttrRasterLayerProps {
    id: string
    values: Plane
    meta: GridMeta
    colour: (v: number) => RGBA | null
}

/** One attribute plane as a pixelated image over the grid. */
export function AttrRasterLayer({id, values, meta, colour}: AttrRasterLayerProps) {
    const url = useMemo(() => {
        const canvas = document.createElement('canvas')
        canvas.width = meta.width
        canvas.height = meta.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.putImageData(new ImageData(rasterPixels(values, meta, colour), meta.width, meta.height), 0, 0)
        return canvas.toDataURL()
    }, [values, meta, colour])
    if (!url) return null
    return (
        <Pane name={`attr-${id}`} style={{zIndex: 350}}>
            <ImageOverlay url={url} bounds={rasterBounds(meta)} className="pixelated" interactive={false}/>
        </Pane>
    )
}
