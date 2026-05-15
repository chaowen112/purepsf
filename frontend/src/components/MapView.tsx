import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'
import { fetchSubzoneStats, type ProjectSummary, type SubzoneFC } from '../api'

export type LayerMode = 'markers' | 'subzones'

type Props = {
  projects: ProjectSummary[]
  selectedId: number | null
  onSelect: (id: number) => void
  onSelectSubzone: (id: number) => void
  onBoundsChange: (bbox: [number, number, number, number]) => void
  layerMode: LayerMode
  // Bumped each time a search hit is picked. The effect that watches this
  // calls map.flyTo on the new coords; previous flyTargets are discarded.
  flyTarget: { lng: number; lat: number; zoom?: number; nonce: number } | null
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

export default function MapView({ projects, selectedId, onSelect, onSelectSubzone, onBoundsChange, layerMode, flyTarget }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subzonesLoadedRef = useRef(false)
  // Map handlers are registered once at mount inside map.on('load'); use refs
  // so they always read the latest props instead of the stale initial closure.
  const onSelectRef = useRef(onSelect)
  const onSelectSubzoneRef = useRef(onSelectSubzone)
  const onBoundsRef = useRef(onBoundsChange)
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  useEffect(() => { onSelectSubzoneRef.current = onSelectSubzone }, [onSelectSubzone])
  useEffect(() => { onBoundsRef.current = onBoundsChange }, [onBoundsChange])
  const [hoverSubzone, setHoverSubzone] = useState<{
    name: string; area: string; avgPsf: number | null; count: number; x: number; y: number
  } | null>(null)

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
            // Relative path → goes through nginx (prod) or Vite proxy (dev)
            // for disk-cached tile reuse.
            tiles: ['/tiles/onemap/{z}/{x}/{y}.png'],
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
      map.addSource('subzones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: 'subzones-fill',
        type: 'fill',
        source: 'subzones',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'case',
            ['==', ['coalesce', ['get', 'count'], 0], 0],
            '#f1f5f9',
            ['interpolate', ['linear'],
              ['coalesce', ['get', 'avg_psf'], 0],
              ...PSF_COLORS.flat(),
            ],
          ],
          'fill-opacity': 0.55,
        },
      })
      map.addLayer({
        id: 'subzones-outline',
        type: 'line',
        source: 'subzones',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#475569', 'line-width': 0.6, 'line-opacity': 0.7 },
      })

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
        if (feat?.properties?.id) onSelectRef.current(feat.properties.id as number)
      })

      map.on('mouseenter', 'projects-circle', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'projects-circle', () => {
        map.getCanvas().style.cursor = ''
      })

      map.on('click', 'subzones-fill', (e) => {
        const feat = e.features?.[0]
        const id = feat?.properties?.id
        if (typeof id === 'number') onSelectSubzoneRef.current(id)
      })

      map.on('mouseenter', 'subzones-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'subzones-fill', () => {
        map.getCanvas().style.cursor = ''
      })

      map.on('mousemove', 'subzones-fill', (e) => {
        const feat = e.features?.[0]
        if (!feat) return
        const p = feat.properties as Record<string, unknown>
        setHoverSubzone({
          name: String(p.subzone_name ?? ''),
          area: String(p.planning_area ?? ''),
          avgPsf: typeof p.avg_psf === 'number' ? p.avg_psf : null,
          count: Number(p.count ?? 0),
          x: e.point.x,
          y: e.point.y,
        })
      })
      map.on('mouseleave', 'subzones-fill', () => setHoverSubzone(null))

      // Emit initial bounds
      const b = map.getBounds()
      onBoundsRef.current([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    })

    map.on('moveend', () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const b = map.getBounds()
        onBoundsRef.current([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
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

  // Fly to a search hit. Nonce-keyed so the same coord triggers a fresh fly.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !flyTarget) return
    map.flyTo({
      center: [flyTarget.lng, flyTarget.lat],
      zoom: flyTarget.zoom ?? 16,
      essential: true,
    })
  }, [flyTarget?.nonce])

  // Layer mode toggle: markers vs subzones (lazy-load subzone data on first show)
  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    const showSubzones = layerMode === 'subzones'
    map.setLayoutProperty('projects-circle', 'visibility', showSubzones ? 'none' : 'visible')
    map.setLayoutProperty('projects-label', 'visibility', showSubzones ? 'none' : 'visible')
    map.setLayoutProperty('subzones-fill', 'visibility', showSubzones ? 'visible' : 'none')
    map.setLayoutProperty('subzones-outline', 'visibility', showSubzones ? 'visible' : 'none')

    if (showSubzones && !subzonesLoadedRef.current) {
      subzonesLoadedRef.current = true
      fetchSubzoneStats()
        .then((fc: SubzoneFC) => {
          const src = map.getSource('subzones') as maplibregl.GeoJSONSource | undefined
          src?.setData(fc as unknown as GeoJSON.FeatureCollection)
        })
        .catch((e) => {
          console.error('fetchSubzoneStats', e)
          subzonesLoadedRef.current = false
        })
    }
  }, [layerMode])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <PSFLegend mode={layerMode} />
      {hoverSubzone && layerMode === 'subzones' && (
        <div
          className="pointer-events-none absolute rounded bg-white/95 px-2 py-1 text-xs shadow border border-slate-100"
          style={{ left: hoverSubzone.x + 12, top: hoverSubzone.y + 12 }}
        >
          <div className="font-medium text-slate-700">{hoverSubzone.name}</div>
          <div className="text-slate-500">{hoverSubzone.area}</div>
          <div className="text-slate-600 mt-0.5">
            {hoverSubzone.avgPsf != null
              ? <>${hoverSubzone.avgPsf.toLocaleString()} PSF · {hoverSubzone.count} txn</>
              : <span className="text-slate-400">no data</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function PSFLegend({ mode }: { mode: LayerMode }) {
  return (
    <div className="absolute bottom-8 left-3 rounded bg-white/90 px-3 py-2 text-xs shadow">
      <div className="mb-1 font-medium text-slate-600">
        {mode === 'subzones' ? 'Subzone avg PSF (all)' : 'PSF (S$/sqft)'}
      </div>
      {PSF_COLORS.slice(1).map(([psf, color]) => (
        <div key={psf} className="flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-3 ${mode === 'subzones' ? 'rounded-sm' : 'rounded-full'}`}
            style={{ background: color }}
          />
          <span className="text-slate-500">{psf.toLocaleString()}+</span>
        </div>
      ))}
    </div>
  )
}
