import L from 'leaflet'
import {Marker} from 'react-leaflet'

const CBD: [number, number] = [-31.955612, 115.860234]

const PIN = `
<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M14 1C6.8 1 1 6.7 1 13.8 1 23.5 14 35 14 35s13-11.5 13-21.2C27 6.7 21.2 1 14 1z"
        fill="#0f766e" stroke="#fff" stroke-width="2"/>
  <circle cx="14" cy="13.5" r="4.5" fill="#fff"/>
</svg>`

const icon = L.divIcon({
    className: 'cbd-marker',
    html: `${PIN}<span class="cbd-label">Perth CBD</span>`,
    iconSize: [28, 36],
    iconAnchor: [14, 36],
})

export function CbdMarker() {
    return <Marker position={CBD} icon={icon} title="Perth CBD" keyboard={false}/>
}
