import {useEffect} from 'react'
import {CircleMarker, Polyline, useMap} from 'react-leaflet'
import {latLngBounds, type LatLngTuple} from 'leaflet'
import type {RideResult} from '../../lib/bike'
import {MODE_COLORS} from '../../lib/route'

interface RideOverlayProps {
    point: [number, number]
    result: RideResult
}

const DASH = '4 6'

export function RideOverlay({point, result}: RideOverlayProps) {
    const map = useMap()
    const path = result.kind === 'ride' ? result.geometry : []
    const connector: LatLngTuple[] = path.length ? [point, path[0]] : []

    useEffect(() => {
        const all = [...connector, ...path]
        if (all.length < 2) return
        const bounds = latLngBounds(all)
        if (!map.getBounds().contains(bounds)) map.fitBounds(bounds, {padding: [48, 48]})
        // fit once per result, not on every re-render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, result])

    if (result.kind === 'outside' || result.kind === 'unreachable') return null
    return (
        <>
            <CircleMarker center={point} radius={6} pathOptions={{color: '#0f172a', fillColor: '#fff', fillOpacity: 1, weight: 3}}/>
            {connector.length > 0 && <Polyline positions={connector} pathOptions={{color: MODE_COLORS.WALK, weight: 3, dashArray: DASH}}/>}
            {path.length > 0 && <Polyline positions={path} pathOptions={{color: MODE_COLORS.BIKE, weight: 5}}/>}
        </>
    )
}
