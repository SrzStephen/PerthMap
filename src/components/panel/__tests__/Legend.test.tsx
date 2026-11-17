import {describe, it, expect} from 'vitest'
import {render, screen} from '@testing-library/react'
import {Legend} from '../Legend'

describe('Legend', () => {
    it('renders one swatch per band', () => {
        render(<Legend minutes={40}/>)
        expect(screen.getAllByTestId('legend-swatch')).toHaveLength(16)
    })

    it('fades bands above the selected minutes', () => {
        render(<Legend minutes={40}/>)
        const swatches = screen.getAllByTestId('legend-swatch')
        const faded = swatches.filter(s => s.classList.contains('opacity-20')).map(s => Number(s.dataset.time))
        expect(faded).toEqual([45, 50, 55, 60, 65, 70, 75, 80, 85])
    })

    it('colours the first swatch with the fastest band colour', () => {
        render(<Legend minutes={40}/>)
        expect(screen.getAllByTestId('legend-swatch')[0]).toHaveStyle({backgroundColor: 'rgb(15, 118, 110)'})
    })
})
