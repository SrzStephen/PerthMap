import {Slider} from '../ui/slider'

interface SidePanelProps {
    filterVal: number,
    filterCB: (value: number[]) => void
}

const SidePanel = ({filterVal, filterCB}: SidePanelProps) => {

    return (
        <div className={"bg-slate-100 flex-col left-0 h-screen m-0 flex p-4"}>
            <p >{filterVal} Minutes to Perth</p>
            <Slider defaultValue={[filterVal]} min={0} max={100} step={5} onValueChange={filterCB}></Slider>
        </div>

    )
}


export default SidePanel;
