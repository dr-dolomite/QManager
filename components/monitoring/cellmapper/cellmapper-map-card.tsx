"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LocateFixed, Maximize2 } from "lucide-react";

// Fix Leaflet default marker icons for webpack bundling
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const BUFFER_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/buffer.sh";
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const DEFAULT_CENTER: [number, number] = [32.158, -95.281]; // East Texas fallback
const DEFAULT_ZOOM = 14;
const MAX_MAP_POINTS = 200;

// Signal strength → color mapping (RSRP dBm)
function signalColor(rsrp: number | null): string {
  if (rsrp === null) return "oklch(0.7 0.1 250)"; // gray-blue
  if (rsrp >= -80) return "oklch(0.75 0.2 145)";  // excellent — green
  if (rsrp >= -90) return "oklch(0.75 0.2 125)";  // good — yellow-green
  if (rsrp >= -100) return "oklch(0.7 0.2 85)";   // fair — yellow
  if (rsrp >= -110) return "oklch(0.65 0.2 50)";  // poor — orange
  return "oklch(0.6 0.25 25)";                     // bad — red
}

function signalLabel(rsrp: number | null): string {
  if (rsrp === null) return "Unknown";
  if (rsrp >= -80) return "Excellent";
  if (rsrp >= -90) return "Good";
  if (rsrp >= -100) return "Fair";
  if (rsrp >= -110) return "Poor";
  return "Weak";
}

interface MapPoint {
  id: number;
  lat: number;
  lon: number;
  signal: number | null;
  type: string | null;
  cellId: number | null;
  capturedAt: number;
}

interface CellMapperMapCardProps {
  gps: {
    source: string;
    fix: {
      type: string; // "3D", "2D", "none"
      lat: number;
      lon: number;
      alt: number;
      sats: number;
      speed_kmh: number;
      hdop: number;
    } | null;
  } | null;
  isLoading: boolean;
  isStale: boolean;
}

// Inner component: auto-pan to GPS position
function MapAutoCenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const prevRef = useRef({ lat: 0, lon: 0 });

  useEffect(() => {
    // Only pan if position changed meaningfully (>50m = ~0.0005 deg)
    const dlat = Math.abs(lat - prevRef.current.lat);
    const dlon = Math.abs(lon - prevRef.current.lon);
    if (dlat > 0.0005 || dlon > 0.0005) {
      map.panTo([lat, lon], { animate: true, duration: 0.5 });
      prevRef.current = { lat, lon };
    }
  }, [lat, lon, map]);

  return null;
}

// Inner component: fit bounds to all points
function FitBoundsButton({
  points,
  gpsLat,
  gpsLon,
}: {
  points: MapPoint[];
  gpsLat?: number;
  gpsLon?: number;
}) {
  const map = useMap();
  const { t } = useTranslation("monitoring");

  const handleFit = useCallback(() => {
    const allLats = points.map((p) => p.lat);
    const allLons = points.map((p) => p.lon);
    if (gpsLat != null && gpsLon != null) {
      allLats.push(gpsLat);
      allLons.push(gpsLon);
    }
    if (allLats.length === 0) return;
    const bounds = L.latLngBounds(
      [Math.min(...allLats), Math.min(...allLons)],
      [Math.max(...allLats), Math.max(...allLons)]
    );
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  }, [map, points, gpsLat, gpsLon]);

  return (
    <Button
      variant="outline"
      size="icon"
      className="absolute top-2 right-2 z-[1000] bg-background/80 backdrop-blur-sm"
      onClick={handleFit}
      title={t("cellmapper.map_fit_bounds")}
    >
      <Maximize2 className="h-4 w-4" />
    </Button>
  );
}

// Inner component: recenter on GPS
function RecenterButton({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const { t } = useTranslation("monitoring");

  return (
    <Button
      variant="outline"
      size="icon"
      className="absolute top-12 right-2 z-[1000] bg-background/80 backdrop-blur-sm"
      onClick={() => map.flyTo([lat, lon], 15, { animate: true, duration: 0.5 })}
      title={t("cellmapper.map_recenter")}
    >
      <LocateFixed className="h-4 w-4" />
    </Button>
  );
}

// Main component
export function CellMapperMapCard({ gps, isLoading, isStale }: CellMapperMapCardProps) {
  const { t } = useTranslation("monitoring");
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [isMapReady, setIsMapReady] = useState(false);

  // Fetch recent buffer points for the map
  const fetchPoints = useCallback(async () => {
    try {
      const resp = await authFetch(`${BUFFER_ENDPOINT}?page=1&limit=${MAX_MAP_POINTS}`);
      const data = await resp.json();
      if (data.success && data.entries) {
        const mapped: MapPoint[] = data.entries
          .filter((e: any) => e.summary?.latitude != null && e.summary?.longitude != null)
          .map((e: any) => ({
            id: e.id,
            lat: e.summary.latitude,
            lon: e.summary.longitude,
            signal: e.summary.signal ?? null,
            type: e.summary.type ?? null,
            cellId: e.summary.CID ?? null,
            capturedAt: e.captured_at,
          }));
        setPoints(mapped);
      }
    } catch {
      // Silently fail -- map just won't have points
    }
  }, []);

  // Fetch points on mount and every 30s
  useEffect(() => {
    fetchPoints();
    const interval = setInterval(fetchPoints, 30000);
    return () => clearInterval(interval);
  }, [fetchPoints]);

  const hasGpsFix = gps?.fix && gps.fix.type !== "none" && gps.fix.lat !== 0;
  const center: [number, number] = hasGpsFix
    ? [gps!.fix!.lat, gps!.fix!.lon]
    : DEFAULT_CENTER;

  // GPS accuracy circle radius (from HDOP -- rough approximation)
  const accuracyRadius = hasGpsFix ? Math.max((gps!.fix!.hdop || 1) * 5, 10) : 0;

  // Legend entries
  const legend = useMemo(
    () => [
      { label: t("cellmapper.map_signal_excellent"), color: signalColor(-70) },
      { label: t("cellmapper.map_signal_good"), color: signalColor(-85) },
      { label: t("cellmapper.map_signal_fair"), color: signalColor(-95) },
      { label: t("cellmapper.map_signal_poor"), color: signalColor(-105) },
      { label: t("cellmapper.map_signal_weak"), color: signalColor(-115) },
    ],
    [t]
  );

  // Loading state
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("cellmapper.map_title")}</CardTitle>
          <CardDescription>{t("cellmapper.map_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card col-span-full @5xl/main:col-span-1">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("cellmapper.map_title")}</CardTitle>
            <CardDescription>
              {points.length > 0
                ? t("cellmapper.map_point_count", { count: points.length })
                : t("cellmapper.map_no_points")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {hasGpsFix && (
              <Badge variant="outline" className="bg-success/15 text-success border-success/30">
                {gps!.fix!.type} {t("cellmapper.map_fix")}
              </Badge>
            )}
            {isStale && (
              <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
                {t("cellmapper.map_stale")}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-3 px-3">
        <div className="relative rounded-lg overflow-hidden border" style={{ height: "400px" }}>
          <MapContainer
            center={center}
            zoom={DEFAULT_ZOOM}
            className="h-full w-full z-0"
            whenReady={() => setIsMapReady(true)}
            scrollWheelZoom={true}
            zoomControl={false}
          >
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />

            {/* Auto-pan to GPS */}
            {hasGpsFix && <MapAutoCenter lat={gps!.fix!.lat} lon={gps!.fix!.lon} />}

            {/* Fit bounds button */}
            {isMapReady && (
              <FitBoundsButton
                points={points}
                gpsLat={hasGpsFix ? gps!.fix!.lat : undefined}
                gpsLon={hasGpsFix ? gps!.fix!.lon : undefined}
              />
            )}

            {/* Recenter button */}
            {hasGpsFix && isMapReady && (
              <RecenterButton lat={gps!.fix!.lat} lon={gps!.fix!.lon} />
            )}

            {/* GPS position marker -- blue circle */}
            {hasGpsFix && (
              <>
                {/* Accuracy circle */}
                <CircleMarker
                  center={[gps!.fix!.lat, gps!.fix!.lon]}
                  radius={accuracyRadius}
                  pathOptions={{
                    color: "oklch(0.6 0.2 250)",
                    fillColor: "oklch(0.7 0.15 250)",
                    fillOpacity: 0.15,
                    weight: 1,
                  }}
                />
                {/* Position dot */}
                <CircleMarker
                  center={[gps!.fix!.lat, gps!.fix!.lon]}
                  radius={8}
                  pathOptions={{
                    color: "#fff",
                    fillColor: "oklch(0.6 0.2 250)",
                    fillOpacity: 0.9,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-semibold">{t("cellmapper.map_gps_position")}</div>
                      <div>{gps!.fix!.lat.toFixed(5)}, {gps!.fix!.lon.toFixed(5)}</div>
                      <div>{t("cellmapper.map_gps_alt")}: {gps!.fix!.alt}m</div>
                      <div>{t("cellmapper.map_gps_speed")}: {gps!.fix!.speed_kmh.toFixed(1)} km/h</div>
                      <div>{t("cellmapper.map_gps_sats")}: {gps!.fix!.sats}</div>
                    </div>
                  </Popup>
                </CircleMarker>
              </>
            )}

            {/* Measurement points */}
            {points.map((pt) => (
              <CircleMarker
                key={pt.id}
                center={[pt.lat, pt.lon]}
                radius={5}
                pathOptions={{
                  color: signalColor(pt.signal),
                  fillColor: signalColor(pt.signal),
                  fillOpacity: 0.7,
                  weight: 1,
                }}
              >
                <Popup>
                  <div className="text-sm space-y-0.5">
                    <div className="font-semibold">
                      {pt.type ?? "—"} • {signalLabel(pt.signal)}
                    </div>
                    {pt.signal != null && <div>RSRP: {pt.signal} dBm</div>}
                    {pt.cellId != null && <div>Cell: {pt.cellId}</div>}
                    <div className="text-muted-foreground text-xs">
                      {new Date(pt.capturedAt * 1000).toLocaleTimeString()}
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>

          {/* Signal legend -- bottom-left overlay */}
          <div className="absolute bottom-2 left-2 z-[1000] bg-background/85 backdrop-blur-sm rounded-md p-2 border text-xs">
            <div className="font-medium mb-1">{t("cellmapper.map_legend_title")}</div>
            <div className="space-y-0.5">
              {legend.map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
