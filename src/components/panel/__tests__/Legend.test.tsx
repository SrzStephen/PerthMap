import {describe, it, expect} from 'vitest'
import {render, screen} from '@testing-library/react'
import {Legend} from '../Legend'
import {TIMES} from '../../../lib/bands'

describe('Legend', () => {
    it('renders one swatch per band', () => {
        render(<Legend times={TIMES} minutes={40}/>)
        expect(screen.getAllByTestId('legend-swatch')).toHaveLength(16)
    })

    it('fades bands above the selected minutes', () => {
        render(<Legend times={TIMES} minutes={40}/>)
        const swatches = screen.getAllByTestId('legend-swatch')
        const faded = swatches.filter(s => s.classList.contains('opacity-20')).map(s => Number(s.dataset.time))
        expect(faded).toEqual([45, 50, 55, 60, 65, 70, 75, 80, 85])
    })

    it('colours the first swatch with the fastest band colour', () => {
        render(<Legend times={TIMES} minutes={40}/>)
        expect(screen.getAllByTestId('legend-swatch')[0]).toHaveStyle({backgroundColor: 'rgb(17, 94, 89)'})
    })

    it('only shows swatches for bands present in the data', () => {
        render(<Legend times={TIMES.slice(1)} minutes={40}/>)
        const swatches = screen.getAllByTestId('legend-swatch')
        expect(swatches).toHaveLength(15)
        expect(swatches[0]).toHaveAttribute('data-time', '15')
        expect(screen.getByText('15')).toBeInTheDocument()
    })
})
