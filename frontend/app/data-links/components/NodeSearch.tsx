'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getColor, GROUP_LABELS } from '../utils/colors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchNode {
  id: string;
  group: number;
}

interface Props {
  nodes: SearchNode[];
  onSelect: (node: SearchNode) => void;
  onClear?: () => void;
}

const MAX_RESULTS = 8;

// ─── Component ────────────────────────────────────────────────────────────────

export function NodeSearch({ nodes, onSelect, onClear }: Props) {
  const [query, setQuery]       = useState('');
  const [open, setOpen]         = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [selected, setSelected] = useState<SearchNode | null>(null);

  const inputRef    = useRef<HTMLInputElement>(null);
  const listRef     = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Filtering ────────────────────────────────────────────────────────────────
  const filtered: SearchNode[] = query.trim().length === 0
    ? []
    : nodes
        .filter(n => n.id.toLowerCase().includes(query.toLowerCase()))
        .slice(0, MAX_RESULTS);

  // Reset active index whenever results change
  useEffect(() => { setActiveIdx(0); }, [query]);

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const commit = useCallback((node: SearchNode) => {
    setSelected(node);
    setQuery('');
    setOpen(false);
    onSelect(node);
  }, [onSelect]);

  const clear = useCallback(() => {
    setQuery('');
    setSelected(null);
    setOpen(false);
    onClear?.();
    inputRef.current?.focus();
  }, [onClear]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (filtered[activeIdx]) commit(filtered[activeIdx]);
        break;
      case 'Escape':
        clear();
        break;
    }
  }, [filtered, activeIdx, commit, clear]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────
  const color = selected ? getColor(selected.group) : undefined;

  return (
    <div ref={containerRef} className="relative w-72">

      {/* Input row */}
      <div
        className="flex items-center gap-2 rounded-xl border border-black/10 bg-[#f5f0e8]/95 px-3 py-2 shadow-sm backdrop-blur-sm transition-shadow focus-within:shadow-md"
        style={selected ? { borderColor: `${color}55` } : undefined}
      >
        {/* Search icon */}
        <svg
          className="h-3.5 w-3.5 shrink-0 text-black/30"
          fill="none" stroke="currentColor" strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>

        {/* Selected badge */}
        {selected && (
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold"
            style={{ backgroundColor: `${color}22`, color }}
          >
            {selected.id}
          </span>
        )}

        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={selected ? 'Search another…' : 'Search nodes…'}
          onChange={e => { setQuery(e.target.value); setOpen(true); setSelected(null); }}
          onFocus={() => { if (query) setOpen(true); }}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-black/70 placeholder-black/50 outline-none"
        />

        {/* Clear button */}
        {(query || selected) && (
          <button
            onMouseDown={e => { e.preventDefault(); clear(); }}
            className="shrink-0 text-black/25 transition-colors hover:text-black/60"
            aria-label="Clear"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-black/10 bg-[#f5f0e8]/98 py-1 shadow-lg backdrop-blur-sm"
        >
          {filtered.map((node, i) => {
            const c = getColor(node.group);
            const label = GROUP_LABELS[node.group] ?? `Group ${node.group}`;
            const isActive = i === activeIdx;
            return (
              <li
                key={node.id}
                onMouseDown={e => { e.preventDefault(); commit(node); }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors ${
                  isActive ? 'bg-black/5' : 'hover:bg-black/[0.03]'
                }`}
              >
                {/* Group colour dot */}
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: c }}
                />

                {/* Node id — highlight matching chars */}
                <span className="flex-1 truncate font-mono text-xs text-black/75">
                  <Highlight text={node.id} query={query} color={c} />
                </span>

                {/* Group label */}
                <span className="shrink-0 font-mono text-[9px] text-black/30">
                  {label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* No results hint */}
      {open && query.trim().length > 0 && filtered.length === 0 && (
        <div className="absolute inset-x-0 top-full z-50 mt-1.5 rounded-xl border border-black/10 bg-[#f5f0e8]/98 px-3 py-3 text-center shadow-lg backdrop-blur-sm">
          <p className="font-mono text-[10px] text-black/30">No nodes match "{query}"</p>
        </div>
      )}
    </div>
  );
}

// ─── Highlight matching substring ─────────────────────────────────────────────

function Highlight({ text, query, color }: { text: string; query: string; color: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color }} className="font-bold">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}
