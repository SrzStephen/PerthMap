import type {DataIndex, DayKey} from '../../lib/grid'
import {Segmented} from './Segmented'

interface DayToggleProps {
    days: DataIndex['days']
    day: DayKey
    onDayChange: (day: DayKey) => void
}

export function DayToggle({days, day, onDayChange}: DayToggleProps) {
    return <Segmented label="Day" options={days.map(d => ({value: d.key, label: d.label}))} value={day} onChange={onDayChange}/>
}
