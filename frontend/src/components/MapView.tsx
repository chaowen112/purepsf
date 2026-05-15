import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import type { ProjectSummary } from '../api'

type Props = {
  projects: ProjectSummary[]
  selectedId: number | null
  onSelect: (id: number) => void
  onBoundsChange: (bbox: [number, number, number, number]) => void
}

const PSF_COLORS: [number, string][] = [
  [0, '#94a3b8'],
  [400, '#22c55e'],
  [1000, '#84cc16'],
  [1500, '#eab308'],
  [2000, '#f97316'],
  [3000, '#ef4444'],
  [5000, '#a855f7'],
]

const colorExpression = (): maplibregl.ExpressionSpecification => [
  'interpolate', ['linear'],
  ['coalesce', ['get', 'avg_psf'], 0],
  ...PSF_COLORS.flat(),
] as maplibregl.ExpressionSpecification

export default function MapView({ projects, selectedId, onSelect, onBoundsChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          onemap: {
            type: 'raster',
            tiles: ['https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OneMap | Singapore Land Authority',
            maxzoom: 19,
          },
        },
        layers: [{ id: 'onemap', type: 'raster', source: 'onemap' }],
      },
      center: [103.8198, 1.3521],
      zoom: 11,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource('projects', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: 'projects-circle',
        type: 'circle',
        source: 'projects',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 9],
          'circle-color': colorExpression(),
          'circle-opacity': 0.85,
          'circle-stroke-width': ['case', ['==', ['get', 'id'], -1], 3, 0],
          'circle-stroke-color': '#1e293b',
        },
      })

      map.addLayer({
        id: 'projects-label',
        type: 'symbol',
        source: 'projects',
        minzoom: 14,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
        },
        paint: { 'text-color': '#1e293b', 'text-halo-color': '#fff', 'text-halo-width': 1 },
      })

      map.on('click', 'projects-circle', (e) => {
        const feat = e.features?.[0]
        if (feat?.properties?.id) onSelect(feat.properties.id as number)
      })

      map.on('mouseenter', 'projects-circle', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'projects-circle', () => {
        map.getCanvas().style.cursor = ''
      })

      // Emit initial bounds
      const b = map.getBounds()
      onBoundsChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    })

    map.on('moveend', () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const b = map.getBounds()
        onBoundsChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
      }, 400)
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update GeoJSON source when projects change
  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    const src = map.getSource('projects') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    src.setData({
      type: 'FeatureCollection',
      features: projects
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng!, p.lat!] },
          properties: { id: p.id, name: p.name, avg_psf: p.avg_psf ?? null },
        })),
    })
  }, [projects])

  // Highlight selected
  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    map.setPaintProperty('projects-circle', 'circle-stroke-width', [
      'case', ['==', ['get', 'id'], selectedId ?? -1], 3, 0,
    ])
  }, [selectedId])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <PSFLegend />
    </div>
  )
}

function PSFLegend() {
  return (
    <div className="absolute bottom-8 left-3 rounded bg-white/90 px-3 py-2 text-xs shadow">
      <div className="mb-1 font-medium text-slate-600">PSF (S$/sqft)</div>
      {PSF_COLORS.slice(1).map(([psf, color]) => (
        <div key={psf} className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
          <span className="text-slate-500">{psf.toLocaleString()}+</span>
        </div>
      ))}
    </div>
  )
}
