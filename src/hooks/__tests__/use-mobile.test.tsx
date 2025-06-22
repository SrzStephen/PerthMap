import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '../use-mobile';

describe('useIsMobile Hook', () => {
  // Mock window.matchMedia
  const matchMediaMock = vi.fn();
  
  // Mock event listener
  let changeListener: (() => void) | null = null;
  
  // Setup mocks before each test
  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();
    
    // Mock window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024 // Default to desktop width
    });
    
    // Mock matchMedia
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: (event: string, listener: () => void) => {
        if (event === 'change') changeListener = listener;
      },
      removeEventListener: () => {
        changeListener = null;
      }
    });
    
    // Apply the mock to window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: matchMediaMock
    });
  });
  
  it('should return false for desktop viewport', () => {
    // Set window.innerWidth to desktop size
    window.innerWidth = 1024;
    
    const { result } = renderHook(() => useIsMobile());
    
    // Initial render should return false for desktop
    expect(result.current).toBe(false);
  });
  
  it('should return true for mobile viewport', () => {
    // Set window.innerWidth to mobile size
    window.innerWidth = 500;
    
    const { result } = renderHook(() => useIsMobile());
    
    // Initial render should return true for mobile
    expect(result.current).toBe(true);
  });
  
  it('should update when viewport changes', () => {
    // Start with desktop viewport
    window.innerWidth = 1024;
    
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    
    // Simulate resize to mobile viewport
    act(() => {
      window.innerWidth = 500;
      if (changeListener) changeListener();
    });
    
    // Should now return true for mobile
    expect(result.current).toBe(true);
    
    // Simulate resize back to desktop viewport
    act(() => {
      window.innerWidth = 1024;
      if (changeListener) changeListener();
    });
    
    // Should now return false for desktop
    expect(result.current).toBe(false);
  });
});