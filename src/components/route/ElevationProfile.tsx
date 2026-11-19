import {MODE_COLORS} from '../../lib/route'

const W = 280, H = 64, MIN_SPAN = 20

/** Height along the ride as a small area chart; flat rides keep a 20 m span so they read as flat. */
export function ElevationProfile({points}: { points: [number, number][] }) {
    const xs = points.map(p => p[0]), hs = points.map(p => p[1])
    let lo = Math.min(...hs), hi = Math.max(...hs)
    if (hi - lo < MIN_SPAN) {
        const mid = (lo + hi) / 2
        lo = mid - MIN_SPAN / 2
        hi = mid + MIN_SPAN / 2
    }
    const xMax = Math.max(xs[xs.length - 1] ?? 0, 1)
    const x = (d: number) => (d / xMax) * W
    const y = (h: number) => H - ((h - lo) / (hi - lo)) * H
    const line = points.map(([d, h], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(h).toFixed(1)}`).join('')
    const area = `${line}L${W},${H}L0,${H}Z`
    return (
        <div className="relative mt-3">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Elevation profile" className="h-16 w-full overflow-visible"
                 preserveAspectRatio="none">
                <path d={area} fill={MODE_COLORS.BIKE} fillOpacity={0.15}/>
                <path d={line} fill="none" stroke={MODE_COLORS.BIKE} strokeWidth={1.5} vectorEffect="non-scaling-stroke"/>
            </svg>
            <span className="absolute top-0 right-0 text-[10px] tabular-nums text-[var(--muted)]">{`${Math.round(hi)} m`}</span>
            <span className="absolute right-0 bottom-0 text-[10px] tabular-nums text-[var(--muted)]">{`${Math.round(lo)} m`}</span>
        </div>
    )
}
