"use client";

/**
 * Generic Leaflet map primitive.
 *
 * Wraps `react-leaflet` with a small, typed surface so feature components
 * (e.g. cellmapper) don't have to reach into Leaflet directly. Designed to
 * be SSR-safe when imported via `next/dynamic({ ssr: false })`.
 *
 * Features:
 *  - Plottable points (CircleMarker) with per-point color and optional popup
 *  - Theme-aware tile fallback: if `tileUrl` is omitted, picks light/dark
 *    OSM/CartoDB tiles based on the resolved next-themes value
 *  - Imperative ref for "center on me" / "fit bounds" / raw Leaflet access
 *  - Slot for arbitrary children rendered inside the MapContainer
 *
 * Note: callers that already render their own <CircleMarker>, <Popup>, etc.
 * inside <Map> can keep doing so — children are passed through unchanged.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { useTheme } from "next-themes";

// Fix Leaflet default marker icons for webpack bundling. Doing this once at
// module load is safe — the module is `ssr: false`-only.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ─── Theme tiles ──────────────────────────────────────────────────────────────

const LIGHT_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const LIGHT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const DARK_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const DARK_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export const MAP_TILE_PRESETS = {
  light: { url: LIGHT_TILE_URL, attribution: LIGHT_TILE_ATTRIBUTION },
  dark: { url: DARK_TILE_URL, attribution: DARK_TILE_ATTRIBUTION },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MapPlottedPoint {
  /** Stable id used as React key. */
  id: string | number;
  lat: number;
  lng: number;
  /** Any CSS color (hex, hsl, oklch, etc.). */
  color: string;
  /** Pixel radius. Default 5. */
  radius?: number;
  /** Fill opacity 0-1. Default 0.7. */
  fillOpacity?: number;
  /** Popup contents — string or ReactNode. */
  popup?: ReactNode;
}

export interface MapHandle {
  /** Pan to a coordinate without changing zoom. */
  panTo: (lat: number, lng: number, zoom?: number) => void;
  /** Smoothly fly to a coordinate (animated). */
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  /** Fit the viewport to the supplied bounds (or the rendered points). */
  fitBounds: (
    bounds?: Array<[number, number]>,
    options?: L.FitBoundsOptions,
  ) => void;
  /** Escape hatch — raw Leaflet map instance, or null before ready. */
  getMap: () => L.Map | null;
}

export interface MapProps {
  /** Points to render as CircleMarkers (in addition to children). */
  points?: MapPlottedPoint[];
  /** Tile URL template. If omitted, derived from `theme`. */
  tileUrl?: string;
  /** Tile attribution. If omitted, derived from `theme`. */
  attribution?: string;
  /** Theme override. Defaults to next-themes resolvedTheme. */
  theme?: "light" | "dark";
  /** Initial map center. */
  center?: [number, number];
  /** Initial zoom level. */
  zoom?: number;
  /** Optional callback fired once with the Leaflet map instance. */
  onMapReady?: (map: L.Map) => void;
  /** Show Leaflet's built-in zoom control. Default false. */
  showZoomControl?: boolean;
  /** Enable scroll-wheel zoom. Default true. */
  scrollWheelZoom?: boolean;
  /** className applied to the MapContainer (sized by parent). */
  className?: string;
  /** Inline style applied to the MapContainer. */
  style?: React.CSSProperties;
  /** Arbitrary children rendered inside the MapContainer. */
  children?: ReactNode;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Bridge component: lives inside <MapContainer> so it can call useMap(),
 * exposes the live map instance to the outer ref + onMapReady.
 */
const MapBridge = forwardRef<MapHandle, { onReady?: (m: L.Map) => void }>(
  function MapBridge({ onReady }, ref) {
    const map = useMap();
    const readyFiredRef = useRef(false);

    useEffect(() => {
      if (!readyFiredRef.current && map) {
        readyFiredRef.current = true;
        onReady?.(map);
      }
    }, [map, onReady]);

    useImperativeHandle(
      ref,
      () => ({
        getMap: () => map ?? null,
        panTo: (lat, lng, zoom) => {
          if (zoom != null) map.setView([lat, lng], zoom, { animate: true });
          else map.panTo([lat, lng], { animate: true });
        },
        flyTo: (lat, lng, zoom) => {
          map.flyTo([lat, lng], zoom ?? map.getZoom(), {
            animate: true,
            duration: 0.5,
          });
        },
        fitBounds: (bounds, options) => {
          if (!bounds || bounds.length === 0) return;
          const lats = bounds.map((b) => b[0]);
          const lngs = bounds.map((b) => b[1]);
          const llb = L.latLngBounds(
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)],
          );
          map.fitBounds(llb, { padding: [30, 30], maxZoom: 16, ...options });
        },
      }),
      [map],
    );

    return null;
  },
);

// ─── Public component ────────────────────────────────────────────────────────

export const Map = forwardRef<MapHandle, MapProps>(function Map(
  {
    points,
    tileUrl,
    attribution,
    theme,
    center = [0, 0],
    zoom = 13,
    onMapReady,
    showZoomControl = false,
    scrollWheelZoom = true,
    className,
    style,
    children,
  },
  ref,
) {
  const { resolvedTheme } = useTheme();
  const effectiveTheme: "light" | "dark" =
    theme ?? (resolvedTheme === "dark" ? "dark" : "light");

  const tile = useMemo(() => {
    if (tileUrl && attribution) return { url: tileUrl, attribution };
    const preset = MAP_TILE_PRESETS[effectiveTheme];
    return {
      url: tileUrl ?? preset.url,
      attribution: attribution ?? preset.attribution,
    };
  }, [tileUrl, attribution, effectiveTheme]);

  const handleReady = useCallback(
    (map: L.Map) => {
      onMapReady?.(map);
    },
    [onMapReady],
  );

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      className={className}
      style={style}
      scrollWheelZoom={scrollWheelZoom}
      zoomControl={showZoomControl}
    >
      {/*
        TileLayer is keyed by URL so that switching theme remounts the layer
        cleanly (Leaflet's TileLayer doesn't update its `url` prop reactively
        in all versions of react-leaflet).
      */}
      <TileLayer key={tile.url} url={tile.url} attribution={tile.attribution} />

      <MapBridge ref={ref} onReady={handleReady} />

      {points?.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lng]}
          radius={p.radius ?? 5}
          pathOptions={{
            color: p.color,
            fillColor: p.color,
            fillOpacity: p.fillOpacity ?? 0.7,
            weight: 1,
          }}
        >
          {p.popup != null && <Popup>{p.popup}</Popup>}
        </CircleMarker>
      ))}

      {children}
    </MapContainer>
  );
});

export default Map;
