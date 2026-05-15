import { useEffect, useRef, useState } from 'react'
import { fetchSearch, type SearchHit } from '../api'

type Props = {
  onPick: (hit: SearchHit) => void
}

export default function SearchBox({ onPick }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced fetch on q change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setHits([])
      return
    }
    debounceRef.current = setTimeout(() => {
      fetchSearch(q).then((res) => {
        setHits(res)
        setActiveIdx(0)
      }).catch((e) => console.error('search', e))
    }, 150)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [q])

  // Close on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (hit: SearchHit) => {
    setOpen(false)
    setQ('')
    onPick(hit)
  }

  return (
    <div ref={containerRef} className="relative w-72">
      <input
        type="text"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); return }
          if (!open || hits.length === 0) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, hits.length - 1)) }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
          if (e.key === 'Enter')     { e.preventDefault(); pick(hits[activeIdx]) }
        }}
        placeholder="Search project, street, area, postal..."
        className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
      />
      {open && hits.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[60vh] overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
          {hits.map((h, i) => (
            <button
              key={`${h.type}-${h.id}`}
              onMouseDown={(e) => { e.preventDefault(); pick(h) }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm border-b border-slate-100 last:border-b-0 ${
                i === activeIdx ? 'bg-slate-50' : 'hover:bg-slate-50'
              }`}
            >
              <Pill type={h.type} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-slate-800">{h.label}</div>
                {h.secondary && <div className="truncate text-xs text-slate-500">{h.secondary}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
      {open && q.trim() && hits.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-lg">
          No matches.
        </div>
      )}
    </div>
  )
}

function Pill({ type }: { type: 'project' | 'subzone' }) {
  return (
    <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${
      type === 'subzone' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'
    }`}>
      {type === 'subzone' ? 'AREA' : 'BLDG'}
    </span>
  )
}
