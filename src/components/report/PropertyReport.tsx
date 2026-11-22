import {RoutePanel} from '../route/RoutePanel'
import {SchoolsSection, type SchoolsState} from './SchoolsSection'
import {HazardsSection, type AttrsState} from './HazardsSection'
import type {ClickedRoute} from '../../lib/useClickedRoute'

interface PropertyReportProps {
    /** Address from search, or the clicked coordinates. */
    title: string
    route: ClickedRoute
    schools: SchoolsState
    asOf: string | null
    /** Hazard and noise facts for the point. */
    attrs?: AttrsState
    onClose: () => void
}

/** Everything known about one point: its route to the CBD, intake schools, then hazards and noise. */
export function PropertyReport({title, route, schools, asOf, attrs = null, onClose}: PropertyReportProps) {
    return (
        <div aria-label="Property report">
            <RoutePanel title={title} result={route.result} dayLabel={route.dayLabel} routes={route.routes}
                        stops={route.stops} onClose={onClose}/>
            <SchoolsSection schools={schools} asOf={asOf}/>
            <HazardsSection attrs={attrs}/>
        </div>
    )
}
