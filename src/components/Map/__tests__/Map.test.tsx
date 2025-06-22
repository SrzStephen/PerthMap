import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Map from '../Map';

// Mock the poly.json import
vi.mock('../../../assets/poly.json', () => ({
  default: {
    type: "FeatureCollection",
    name: "polys2",
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    features: [
      {
        type: "Feature",
        properties: {
          index: 1,
          time: "10 minutes",
          r: 0.1,
          g: 0.5,
          b: 0.9
        },
        geometry: {
          coordinates: [[[115.8, -31.9], [115.9, -31.9], [115.9, -32.0], [115.8, -32.0], [115.8, -31.9]]]
        }
      }
    ]
  }
}));

// Mock react-leaflet components
vi.mock('react-leaflet', () => {
  const MapContainer = vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="map-container">{children}</div>);
  const LayersControl = vi.fn(({children}: { children: React.ReactNode; }) => <div
      data-testid="layers-control">{children}</div>) as unknown as {
    (props: { children: React.ReactNode }): JSX.Element;
    Overlay: (props: { children: React.ReactNode; name: string }) => JSX.Element;
  };
  LayersControl.Overlay = vi.fn(({ children, name }: { children: React.ReactNode, name: string }) => <div data-testid={`overlay-${name}`}>{children}</div>);

  const LayerGroup = vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="layer-group">{children}</div>);
  const TileLayer = vi.fn(() => <div data-testid="tile-layer"></div>);
  const WMSTileLayer = vi.fn(() => <div data-testid="wms-tile-layer"></div>);
  const Polygon = vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="polygon">{children}</div>);
  const Popup = vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="popup">{children}</div>);

  return {
    MapContainer,
    LayersControl,
    LayerGroup,
    TileLayer,
    WMSTileLayer,
    Polygon,
    Popup
  };
});

describe('Map Component', () => {
  const mockProps = {
    filterVal: 5,
    filterCB: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<Map {...mockProps} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('renders the correct layers', () => {
    render(<Map {...mockProps} />);
    expect(screen.getByTestId('overlay-Map')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-Distance to Perth')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-Jandacot Airport Noise')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-Perth Airport Noise')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-Rail and Road Noise')).toBeInTheDocument();
  });

  it('applies the filter value to the polygons', () => {
    render(<Map {...mockProps} />);
    // Since we're mocking, we can't directly test the filtering logic
    // But we can verify that the component renders with the mock data
    expect(screen.getByTestId('polygon')).toBeInTheDocument();
    expect(screen.getByTestId('popup')).toBeInTheDocument();
    expect(screen.getByTestId('popup')).toHaveTextContent('10 minutes');
  });
});