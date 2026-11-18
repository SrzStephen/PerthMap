import {RoutePanel} from '../route/RoutePanel'
import {SchoolsSection, type SchoolsState} from './SchoolsSection'
import type {ClickedRoute} from '../../lib/useClickedRoute'

interface PropertyReportProps {
    /** Address from search, or the clicked coordinates. */
    title: string
    route: ClickedRoute
    schools: SchoolsState
    asOf: string | null
    onClose: () => void
}

/** Everything known about one point: its route to the CBD, then its intake schools. */
export function PropertyReport({title, route, schools, asOf, onClose}: PropertyReportProps) {
    return (
        <div aria-label="Property report">
            <RoutePanel title={title} result={route.result} dayLabel={route.dayLabel} routes={route.routes}
                        stops={route.stops} onClose={onClose}/>
            <SchoolsSection schools={schools} asOf={asOf}/>
        </div>
    )
}

export const pointTitle = ([lat, lng]: [number, number]) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`
