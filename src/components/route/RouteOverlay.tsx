import {useEffect} from 'react'
import {CircleMarker, Polyline, useMap} from 'react-leaflet'
import {latLngBounds, type LatLngTuple} from 'leaflet'
import {isWalk, legGeometry, modeColor, MODE_COLORS, type RouteResult, type Routes, type Stops} from '../../lib/route'

interface RouteOverlayProps {
    point: [number, number]
    result: RouteResult
    routes: Routes | null
    stops: Stops | null
}

const WALK_DASH = '4 6'

export function RouteOverlay({point, result, routes, stops}: RouteOverlayProps) {
    const map = useMap()
    const transit = result.kind === 'transit' && routes ? result : null
    const board = transit && stops?.[transit.boardStop]
    const legs = transit && routes
        ? transit.trip[2].map(leg => ({leg, pts: legGeometry(leg, routes), walk: isWalk(leg, routes), mode: routes.lines[leg[0]][0]}))
        : []
    const access: LatLngTuple[] = board ? [point, [board[1], board[2]]] : []

    useEffect(() => {
        const all = [...access, ...legs.flatMap(l => l.pts)]
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
            {access.length > 0 && <Polyline positions={access} pathOptions={{color: MODE_COLORS.WALK, weight: 3, dashArray: WALK_DASH}}/>}
            {legs.map(({pts, walk, mode}, i) => (
                <Polyline key={i} positions={pts}
                          pathOptions={walk ? {color: MODE_COLORS.WALK, weight: 3, dashArray: WALK_DASH} : {color: modeColor(mode), weight: 5}}/>
            ))}
            {legs.filter(l => !l.walk && l.pts.length).flatMap(({pts}, i) => [pts[0], pts[pts.length - 1]].map((p, j) => (
                <CircleMarker key={`${i}-${j}`} center={p} radius={4} pathOptions={{color: '#0f172a', fillColor: '#fff', fillOpacity: 1, weight: 2}}/>
            )))}
        </>
    )
}
