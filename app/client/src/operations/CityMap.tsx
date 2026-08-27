/**
 * "Where the at-risk subscribers are" — bubble map.
 *
 * Real world map (OSM/CARTO Positron raster tiles via react-leaflet) with one
 * CircleMarker per home metro. Radius = sqrt-scaled at-risk count. When the
 * agent's write fires `dataMutated`, every bucket is refetched and the bubbles
 * whose `count` changed get a brief stroke-thickening "pulse".
 *
 * Implementation notes (Leaflet has sharp edges):
 *   - radius is a top-level prop → react-leaflet calls setRadius() on diff.
 *   - pathOptions go through setStyle() — color, fillColor, weight all work.
 *   - FitBounds only re-fits when the set of metro KEYS changes, not on
 *     count-only updates — otherwise the map wobbles every refetch.
 *   - Leaflet CSS is imported in client/src/index.css (not here).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe2, RefreshCw } from 'lucide-react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { fetchCareMetros } from '@/lib/caredesk';
import { dataMutated } from '@/lib/events';
import type { MetroBucket } from '@/shared/types';

const PRIMARY = '#1e2659'; // matches --primary; SVG fill won't take var(...)
const RADIUS_MIN = 5;
const RADIUS_MAX = 32;
const RADIUS_SCALE = 2.6;
const PULSE_MS = 1100;
const PULSE_WEIGHT = 4;
const REST_WEIGHT = 1.5;

function radiusFor(count: number): number {
  return Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, Math.sqrt(Math.max(1, count)) * RADIUS_SCALE));
}

// Re-fit only when the SET of metro keys changes. Count-only changes (the
// agent recording an action) must NOT pan the map.
function FitBoundsOnSetChange({ metros }: { metros: MetroBucket[] }) {
  const map = useMap();
  const lastKey = useRef<string>('');

  useEffect(() => {
    if (metros.length === 0) return;
    const key = metros
      .map((m) => m.metro)
      .sort()
      .join('|');
    if (key === lastKey.current) return;
    lastKey.current = key;

    const lats = metros.map((m) => m.lat);
    const lngs = metros.map((m) => m.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    if (Math.abs(maxLat - minLat) < 0.5 && Math.abs(maxLng - minLng) < 0.5) {
      map.setView([metros[0].lat, metros[0].lng], 6, { animate: true });
      return;
    }
    map.fitBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { padding: [40, 40], animate: true },
    );
  }, [metros, map]);
  return null;
}

export function CityMap() {
  const [metros, setMetros] = useState<MetroBucket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function reload() {
      fetchCareMetros()
        .then((data) => {
          if (cancelled) return;
          setMetros(data);
          setError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setError((e as Error).message);
        });
    }
    reload();
    const unsub = dataMutated.subscribe(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Couldn't load the map: {error}
      </div>
    );
  }

  if (metros === null) {
    return (
      <div className="rounded-xl border border-border bg-card h-[280px] sm:h-[340px] flex items-center justify-center text-sm text-muted-foreground gap-2">
        <RefreshCw className="size-3.5 animate-spin" />
        Loading map…
      </div>
    );
  }

  const totalSubscribers = metros.reduce((a, m) => a + m.count, 0);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Globe2 className="size-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold truncate">At-risk subscribers by metro</h3>
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {metros.length} {metros.length === 1 ? 'metro' : 'metros'} · {totalSubscribers}
        </div>
      </div>
      <div className="h-[280px] sm:h-[340px] relative">
        {metros.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No at-risk subscribers in the current scope.
          </div>
        ) : (
          <MapContainer
            center={[30, 10]}
            zoom={2}
            minZoom={2}
            scrollWheelZoom={false}
            worldCopyJump
            className="h-full w-full"
            style={{ background: 'var(--muted)' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              subdomains={['a', 'b', 'c', 'd']}
              maxZoom={19}
            />
            <FitBoundsOnSetChange metros={metros} />
            {metros.map((m) => (
              <MetroBubble key={m.metro} metro={m} />
            ))}
          </MapContainer>
        )}
      </div>
    </div>
  );
}

function MetroBubble({ metro }: { metro: MetroBucket }) {
  const prevCount = useRef<number | null>(null);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (prevCount.current === null) {
      prevCount.current = metro.count;
      return;
    }
    if (prevCount.current === metro.count) return;
    prevCount.current = metro.count;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), PULSE_MS);
    return () => clearTimeout(t);
  }, [metro.count]);

  const pathOptions = useMemo(
    () => ({
      color: PRIMARY,
      fillColor: PRIMARY,
      fillOpacity: pulsing ? 0.75 : 0.55,
      weight: pulsing ? PULSE_WEIGHT : REST_WEIGHT,
    }),
    [pulsing],
  );

  const actionedPct = metro.count > 0 ? Math.round((metro.actioned / metro.count) * 100) : 0;

  return (
    <CircleMarker center={[metro.lat, metro.lng]} radius={radiusFor(metro.count)} pathOptions={pathOptions}>
      <Tooltip direction="top" offset={[0, -4]} opacity={1}>
        <div className="text-xs">
          <div className="font-semibold">{metro.metro}</div>
          <div>{metro.count} at-risk subscribers</div>
          <div>{actionedPct}% actioned</div>
          <div>
            ${metro.clv_at_risk_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })} CLV at risk
          </div>
        </div>
      </Tooltip>
    </CircleMarker>
  );
}
