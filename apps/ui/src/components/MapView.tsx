import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Map as MapLibre,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Der Karten-Worker liegt als eigene Datei vor; Vite kopiert sie als Asset (offline, gleiche Herkunft).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(workerUrl);
import type { IncidentView, VehicleView, WorldInfo } from '@ls112/protocol';
import { lookup } from '../lookup';
import { useSim } from '../sim-store';
import css from './MapView.module.css';

/** Dunkler, eigener Kartenstil – ohne Schriften, Beschriftungen kommen als HTML-Marker. */
function buildStyle(world: WorldInfo): StyleSpecification {
  const road = (cls: string, color: string, w: [number, number]) => ({
    id: `road-${cls}`,
    type: 'line' as const,
    source: 'roads',
    filter: ['==', ['get', 'cls'], cls] as ['==', ['get', string], string],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': color,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, w[0], 15, w[1]] as unknown as number,
    },
  });
  return {
    version: 8,
    sources: {
      areas: { type: 'geojson', data: world.map.areas as never },
      water: { type: 'geojson', data: world.map.water as never },
      roads: { type: 'geojson', data: world.map.roads as never },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0c1319' } },
      {
        id: 'forest',
        type: 'fill',
        source: 'areas',
        filter: ['==', ['get', 'kind'], 'forest'],
        paint: { 'fill-color': '#10241a', 'fill-opacity': 0.95 },
      },
      {
        id: 'town',
        type: 'fill',
        source: 'areas',
        filter: ['==', ['get', 'kind'], 'town'],
        paint: { 'fill-color': '#1a2634', 'fill-opacity': 0.95 },
      },
      {
        id: 'river',
        type: 'line',
        source: 'water',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#1d5687',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 14],
        },
      },
      road('residential', '#3d4d5e', [0.6, 4.5]),
      road('urban_main', '#6a7d91', [1.1, 6.5]),
      road('tertiary', '#7d7c63', [1, 5]),
      road('secondary', '#a69458', [1.3, 6]),
      road('primary', '#c98a32', [1.8, 7]),
      road('link', '#c98a32', [1.2, 5]),
      road('motorway', '#e0a92a', [2.4, 9]),
    ],
  };
}

/**
 * MapLibre setzt eigene Klassen auf das Marker-Element; unsere Darstellung liegt deshalb in einem
 * inneren Element, dessen Klassen wir frei ändern dürfen.
 */
function markerElement(): { outer: HTMLDivElement; inner: HTMLDivElement } {
  const outer = document.createElement('div');
  const inner = document.createElement('div');
  outer.appendChild(inner);
  return { outer, inner };
}

interface Tween {
  marker: Marker;
  el: HTMLDivElement;
  from: [number, number];
  to: [number, number];
  t0: number;
  t1: number;
}

export function MapView() {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const host = useSim((s) => s.host);
  const selectedIncidentId = useSim((s) => s.selectedIncidentId);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const vehicles = useRef(new Map<string, Tween>());
  const incidents = useRef(new Map<string, { marker: Marker; el: HTMLDivElement }>());

  // Karte und statische Marker (Orte, Wachen, Kliniken) einmal je Welt anlegen.
  useEffect(() => {
    if (!world || !container.current) return;
    const L = lookup(world);
    const map = new MapLibre({
      container: container.current,
      style: buildStyle(world),
      bounds: world.map.bounds as [[number, number], [number, number]],
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxZoom: 17,
      minZoom: 9,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    const add = (lonlat: [number, number], cls: string, text: string, title: string) => {
      const { outer, inner } = markerElement();
      inner.className = cls;
      inner.textContent = text;
      inner.title = title;
      new Marker({ element: outer }).setLngLat(lonlat).addTo(map);
    };
    for (const town of world.towns) {
      const label = world.map.labels.features.find((f) => f.properties.name === town.name);
      const big = label?.properties.kind === 'kreisstadt';
      add(
        L.toLonLat(town.x, town.y),
        `${css.townLabel ?? ''} ${big ? (css.townBig ?? '') : ''}`,
        town.name,
        town.name,
      );
    }
    for (const s of world.stations) {
      const doctor = s.kind === 'notarztstandort';
      add(
        L.toLonLat(s.position[0], s.position[1]),
        `${css.station ?? ''} ${doctor ? (css.doctorStation ?? '') : ''}`,
        doctor ? 'NA' : 'RW',
        `${s.name} (${doctor ? t('map.doctor') : t('map.station')})`,
      );
    }
    for (const h of world.hospitals) {
      add(
        L.toLonLat(h.position[0], h.position[1]),
        css.hospital ?? '',
        'H',
        `${h.name} – ${t('map.hospital')}`,
      );
    }

    // Weiche Bewegung: zwischen zwei Zustandsmeldungen (10 Hz) mit 60 FPS interpolieren.
    let frame = 0;
    const animate = () => {
      const now = performance.now();
      for (const tw of vehicles.current.values()) {
        const f = tw.t1 > tw.t0 ? Math.min(1, (now - tw.t0) / (tw.t1 - tw.t0)) : 1;
        const x = tw.from[0] + (tw.to[0] - tw.from[0]) * f;
        const y = tw.from[1] + (tw.to[1] - tw.from[1]) * f;
        tw.marker.setLngLat(L.toLonLat(x, y));
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    const vehicleMap = vehicles.current;
    const incidentMap = incidents.current;
    return () => {
      cancelAnimationFrame(frame);
      vehicleMap.clear();
      incidentMap.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [world, t]);

  // Fahrzeuge und Einsätze bei jeder Zustandsmeldung aktualisieren.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !world || !host) return;
    const L = lookup(world);
    const now = performance.now();
    for (const v of host.view.vehicles) updateVehicle(map, v, now, L.vehicle(v.id)?.short ?? v.id);
    syncIncidents(
      map,
      host.view.incidents.filter((i) => i.status !== 'closed'),
    );

    function updateVehicle(m: MapLibre, v: VehicleView, at: number, label: string) {
      let tw = vehicles.current.get(v.id);
      if (!tw) {
        const { outer, inner: el } = markerElement();
        outer.addEventListener('click', () => {
          const state = useSim.getState();
          const view = state.host?.view.vehicles.find((x) => x.id === v.id);
          state.focusVehicle(v.id);
          if (view?.incidentId) state.selectIncident(view.incidentId);
        });
        const marker = new Marker({ element: outer }).setLngLat(L.toLonLat(v.x, v.y)).addTo(m);
        tw = { marker, el, from: [v.x, v.y], to: [v.x, v.y], t0: at, t1: at };
        vehicles.current.set(v.id, tw);
      }
      const f = tw.t1 > tw.t0 ? Math.min(1, (at - tw.t0) / (tw.t1 - tw.t0)) : 1;
      tw.from = [
        tw.from[0] + (tw.to[0] - tw.from[0]) * f,
        tw.from[1] + (tw.to[1] - tw.from[1]) * f,
      ];
      tw.to = [v.x, v.y];
      tw.t0 = at;
      tw.t1 = at + 120;
      tw.el.className = `${css.vehicle ?? ''} ${css[`fms${v.status.toString()}`] ?? ''} ${v.emergency && v.moving ? (css.blue ?? '') : ''}`;
      tw.el.textContent = `${v.status.toString()} ${label}`;
      tw.el.dataset.testid = 'vehicle-marker';
    }

    function syncIncidents(m: MapLibre, list: readonly IncidentView[]) {
      const seen = new Set<string>();
      for (const i of list) {
        seen.add(i.id);
        const a = L.address(i.addressId);
        if (!a) continue;
        let entry = incidents.current.get(i.id);
        if (!entry) {
          const { outer, inner: el } = markerElement();
          outer.addEventListener('click', () => {
            useSim.getState().selectIncident(i.id);
          });
          entry = {
            marker: new Marker({ element: outer }).setLngLat(L.toLonLat(a.x, a.y)).addTo(m),
            el,
          };
          incidents.current.set(i.id, entry);
        }
        entry.marker.setLngLat(L.toLonLat(a.x, a.y));
        const urgent =
          i.status === 'open' || (i.doctorRequested && !i.finding?.needsDoctor) || i.locating;
        entry.el.className = `${css.incident ?? ''} ${urgent ? (css.incidentUrgent ?? '') : ''} ${i.id === selectedIncidentId ? (css.incidentSelected ?? '') : ''}`;
        entry.el.textContent = L.keywordCode(i.keywordId);
        entry.el.title = `${i.id} – ${L.addressLabel(i.addressId)}`;
      }
      for (const [id, entry] of incidents.current) {
        if (!seen.has(id)) {
          entry.marker.remove();
          incidents.current.delete(id);
        }
      }
    }
  }, [host, world, selectedIncidentId]);

  // Ausgewählten Einsatz in den Blick nehmen – sobald er im Zustand angekommen ist.
  const centered = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !world || !selectedIncidentId || centered.current === selectedIncidentId) return;
    const incident = host?.view.incidents.find((i) => i.id === selectedIncidentId);
    const a = incident ? lookup(world).address(incident.addressId) : undefined;
    if (!a) return;
    centered.current = selectedIncidentId;
    map.easeTo({
      center: lookup(world).toLonLat(a.x, a.y),
      zoom: Math.max(map.getZoom(), 13.2),
      duration: 700,
    });
  }, [selectedIncidentId, world, host]);

  return (
    <div className={css.wrap}>
      <div ref={container} className={css.map} data-testid="map" />
      <div className={css.attribution}>{world?.map.attribution ?? t('map.fictional')}</div>
    </div>
  );
}
