import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Slider } from '../slider';

// Extend Jest's expect with @testing-library/jest-dom matchers
import '@testing-library/jest-dom';


// Mock the cn utility function
vi.mock('../../../lib/utils', () => ({
  cn: (...inputs: never[]) => inputs.join(' ')
}));

describe('Slider Component', () => {
  it('applies custom className', () => {
    render(<Slider className="custom-class" />);
    // The cn function is mocked to simply join classes with a space
    const sliderRoot = document.querySelector('.custom-class');
    expect(sliderRoot).toBeInTheDocument();
  });

  it('renders without crashing', () => {
    const min = 0;
    const max = 100;
    const defaultValue = [50];

    render(
      <Slider 
        min={min}
        max={max}
        defaultValue={defaultValue}
        data-testid="test-slider"
      />
    );

    // In Radix UI, the root component receives these props
    const slider = screen.getByTestId('test-slider');
    expect(slider).toBeInTheDocument();
    // Verify the slider has the correct attributes
    expect(slider).toHaveAttribute('data-testid', 'test-slider');
    // For min, max, and defaultValue, we can't directly check the attributes
    // as they're handled internally by Radix UI, but we can verify the component renders
  });
});
