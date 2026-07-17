'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconMaximize, IconMinimize, IconX } from '@tabler/icons-react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import rawData from '../mock-data/mock-2.json';
import { NodeSearch } from './NodeSearch';
import { getColor, GROUP_COLORS, GROUP_LABELS } from '../utils/colors';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  group: number;
  color?: string;
  x?: number;
  y?: number;
  z?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  value: number;
  distance?: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BG_COLOR = '#f5f0e8';

const ALL_NODES = rawData.nodes as GraphNode[];
const ALL_LINKS = rawData.links as GraphLink[];
const CLIENT_NODES = ALL_NODES.filter(n => n.group !== 10);

// ─── Filter helper ────────────────────────────────────────────────────────────

function getFilteredData(clientId: string): GraphData {
  const nodeId = (v: string | GraphNode) =>
    typeof v === 'string' ? v : v.id;

  // Collect sales rep IDs linked to the selected client
  const salesRepIds = new Set<string>();
  for (const link of ALL_LINKS) {
    const src = nodeId(link.source);
    const tgt = nodeId(link.target);
    if (src === clientId || tgt === clientId) {
      const otherId = src === clientId ? tgt : src;
      const other = ALL_NODES.find(n => n.id === otherId);
      if (other?.group === 10) salesRepIds.add(otherId);
    }
  }

  // Collect every node + link connected to those sales reps
  const visibleIds = new Set<string>([clientId]);
  salesRepIds.forEach(id => visibleIds.add(id));

  const filteredLinks: GraphLink[] = [];
  for (const link of ALL_LINKS) {
    const src = nodeId(link.source);
    const tgt = nodeId(link.target);
    if (salesRepIds.has(src) || salesRepIds.has(tgt)) {
      visibleIds.add(src);
      visibleIds.add(tgt);
      filteredLinks.push(link);
    }
  }

  return {
    nodes: ALL_NODES.filter(n => visibleIds.has(n.id)),
    links: filteredLinks,
  };
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-black/10 bg-[#f5f0e8]/80 p-3 backdrop-blur-sm">
      <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-black/40">
        Groups
      </p>
      <ul className="space-y-1">
        {Object.keys(GROUP_LABELS).map(Number).map(g => (
          <li key={g} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: getColor(g) }} />
            <span className="font-mono text-[10px] text-black/60">{GROUP_LABELS[g]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ForceGraph() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const spriteMapRef = useRef<Map<string, SpriteText>>(new Map());
  const focusedNodeRef = useRef<GraphNode | null>(null);
  const autoRotateRef = useRef(true);

  const [referrer, setReferrer] = useState('/dashboard');
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [displayData, setDisplayData] = useState<GraphData>({ nodes: [], links: [] });
  const [focusedNode, setFocusedNode] = useState<GraphNode | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadingDone, setLoadingDone] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // ── Filter state ───────────────────────────────────────────────────────────
  const [filterClientId, setFilterClientId] = useState<string | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      fgRef.current?.pauseAnimation();
      spriteMapRef.current.clear();
    };
  }, []);

  // ── Fullscreen ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  // ── Record the route the user navigated from ───────────────────────────────
  useEffect(() => {
    if (typeof document === 'undefined') return;
    try {
      const ref = document.referrer;
      if (ref) {
        const url = new URL(ref);
        if (url.origin === window.location.origin && url.pathname !== '/data-links') {
          setReferrer(url.pathname);
        }
      }
    } catch {
      // malformed referrer — keep the default
    }
  }, []);

  // ── Auto-rotate around Z axis ──────────────────────────────────────────────
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);

  useEffect(() => {
    const SPEED = 0.003;
    let rafId: number;

    const tick = () => {
      const fg = fgRef.current;
      if (!fg || !autoRotateRef.current) return;
      const camera = fg.camera();
      const { x, y, z } = camera.position;
      const cos = Math.cos(SPEED);
      const sin = Math.sin(SPEED);
      camera.position.set(x * cos - y * sin, x * sin + y * cos, z);
      camera.lookAt(0, 0, 0);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // ── Measure container ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    ro.observe(el);
    setDimensions({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── Gradual node loading — reruns when filter changes ─────────────────────
  useEffect(() => {
    const source = filterClientId ? getFilteredData(filterClientId) : { nodes: ALL_NODES, links: ALL_LINKS };
    const sourceNodes = source.nodes.map(n => ({ ...n }));
    const sourceLinks = source.links;
    const total = sourceNodes.length;

    // Reset
    setDisplayData({ nodes: [], links: [] });
    setLoadingDone(false);
    setLoadProgress(0);
    spriteMapRef.current.clear();

    let idx = 0;
    const id = setInterval(() => {
      if (idx >= total) {
        clearInterval(id);
        setDisplayData(prev => ({ nodes: prev.nodes, links: sourceLinks }));
        setLoadingDone(true);
        return;
      }
      const batch = sourceNodes.slice(idx, idx + 25);
      idx += 25;
      setLoadProgress(Math.round((idx / total) * 100));
      setDisplayData(prev => ({ nodes: [...prev.nodes, ...batch], links: [] }));
    }, 90);

    return () => clearInterval(id);
  }, [filterClientId]);

  // ── Auto-focus selected client once filtered graph finishes loading ────────
  useEffect(() => {
    if (!loadingDone || !pendingFocusId) return;
    const node = displayData.nodes.find(n => n.id === pendingFocusId);
    if (node) {
      setFocusedNode(node);
      setPendingFocusId(null);
    }
  }, [loadingDone, pendingFocusId, displayData.nodes]);

  // ── Node 3D object (SpriteText) ────────────────────────────────────────────
  const nodeThreeObject = useCallback((node: GraphNode) => {
    const isFocused = focusedNodeRef.current?.id === node.id;
    const sprite = new SpriteText(node.id);
    sprite.color = isFocused ? '#ffffff' : getColor(node.group);
    sprite.textHeight = isFocused ? 11 : 8;
    sprite.padding = 3;
    sprite.backgroundColor = isFocused
      ? 'rgba(100,100,100,0.82)'
      : 'rgba(245,240,232,0.82)';
    sprite.borderRadius = 8;
    sprite.fontFace = 'JetBrains Mono, Courier New, monospace';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sprite as any).center.y = -0.6;
    spriteMapRef.current.set(node.id as string, sprite);
    return sprite;
  }, []);

  // Keep focusedNodeRef in sync, then surgically mutate only the 2 affected sprites
  useEffect(() => {
    const prev = focusedNodeRef.current;
    focusedNodeRef.current = focusedNode;

    if (prev) {
      const sprite = spriteMapRef.current.get(prev.id);
      if (sprite) {
        sprite.color = getColor(prev.group);
        sprite.textHeight = 8;
        sprite.backgroundColor = 'rgba(245,240,232,0.82)';
      }
    }

    if (focusedNode) {
      const sprite = spriteMapRef.current.get(focusedNode.id);
      if (sprite) {
        sprite.color = '#ffffff';
        sprite.textHeight = 11;
        sprite.backgroundColor = 'rgba(100,100,100,0.52)';
      }
    }
  }, [focusedNode]);

  const getNodeColor = useCallback(
    (node: GraphNode) => (node.id === focusedNode?.id ? '#121a15' : getColor(node.group)),
    [focusedNode],
  );

  // ── Click handlers ─────────────────────────────────────────────────────────
  const handleNodeClick = useCallback((node: GraphNode) => {
    const alreadyFocused = focusedNode?.id === node.id;
    setFocusedNode(alreadyFocused ? null : node);
  }, [focusedNode]);

  const handleBackgroundClick = useCallback(() => {
    if (focusedNode) setFocusedNode(null);
  }, [focusedNode]);

  // ── Search: filter graph to client's sales rep + their sibling clients ─────
  const handleSearchSelect = useCallback((searched: { id: string; group: number }) => {
    setFocusedNode(null);
    setFilterClientId(searched.id);
    setPendingFocusId(searched.id);
  }, []);

  const handleSearchClear = useCallback(() => {
    setFocusedNode(null);
    setFilterClientId(null);
    setPendingFocusId(null);
  }, []);

  // ── Apply link distances via d3 force ──────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('link')?.distance((link: GraphLink) => (link.distance ?? 100) * 1.5);
    fg.d3ReheatSimulation?.();
  }, [loadingDone]);

  // ── Directional particles ──────────────────────────────────────────────────
  const getLinkParticles = useCallback(
    (link: GraphLink) => Math.max(1, Math.ceil(link.value / 4)), []);

  const getLinkParticleSpeed = useCallback(
    (link: GraphLink) => Math.min(link.value * 0.0008, 0.006), []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getLinkParticleColor = useCallback((link: any) => {
    const t = link.target;
    return getColor(typeof t === 'object' && t !== null ? (t.group as number) : 0);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  const isFiltered = !!filterClientId;
  const filteredSalesRepCount = isFiltered
    ? displayData.nodes.filter(n => n.group === 10).length
    : 0;
  const filteredClientCount = isFiltered
    ? displayData.nodes.filter(n => n.group !== 10).length
    : 0;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">

      {/* Loading progress bar */}
      {!loadingDone && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
          <div
            className="h-0.5 bg-blue-500 transition-all duration-75"
            style={{ width: `${loadProgress}%` }}
          />
          <p className="mt-2 text-center font-mono text-[10px] text-black/30">
            Loading graph — {loadProgress}%
          </p>
        </div>
      )}

      {/* Fullscreen toggle */}
      <button
        onClick={toggleFullscreen}
        className="absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded-lg border border-black/10 bg-[#f5f0e8]/80 px-3 py-1.5 font-mono text-[11px] text-black/50 backdrop-blur-sm transition-colors hover:border-black/20 hover:text-black/80"
      >
        {isFullscreen ? <IconMinimize size={13} /> : <IconMaximize size={13} />}
        {isFullscreen ? 'exit fullscreen' : 'fullscreen'}
      </button>

      {/* Close */}
      <button
        onClick={() => router.push(referrer)}
        className="w-28 absolute right-4 top-14 z-20 flex items-center gap-1.5 rounded-lg border border-black/10 bg-[#f5f0e8]/80 px-3 py-1.5 font-mono text-[11px] text-black/50 backdrop-blur-sm transition-colors hover:border-black/20 hover:text-black/80"
      >
        <IconX size={13} />
        close
      </button>

      {/* Focused node info card */}
      {focusedNode && (
        <div className="absolute right-4 top-24 z-10 min-w-[144px] rounded-xl border border-black/10 bg-[#f5f0e8]/90 p-4 font-mono backdrop-blur-sm">
          <p className="mb-0.5 text-[9px] uppercase tracking-widest text-black/30">focused</p>
          <p className="text-sm font-bold" style={{ color: getColor(focusedNode.group) }}>
            {focusedNode.id}
          </p>
          <p className="mt-0.5 text-[10px] text-black/40">
            {GROUP_LABELS[focusedNode.group] ?? `Group ${focusedNode.group}`}
          </p>
          <button
            onClick={() => setFocusedNode(null)}
            className="mt-3 text-[10px] text-black/30 transition-colors hover:text-black/70"
          >
            ✕ reset view
          </button>
        </div>
      )}

      {/* Search + filter banner */}
      <div className="absolute inset-x-0 top-4 z-10 flex flex-col items-center gap-2 px-4">
        <NodeSearch
          nodes={CLIENT_NODES}
          onSelect={handleSearchSelect}
          onClear={handleSearchClear}
        />

        {/* Filter banner — shown while a client filter is active */}
        {isFiltered && loadingDone && (
          <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-[#f5f0e8]/95 px-3 py-1.5 font-mono text-[10px] backdrop-blur-sm">
            <span className="text-black/40">Showing</span>
            <span className="font-semibold text-black/70">{filterClientId}</span>
            <span className="text-black/30">·</span>
            <span className="text-black/40">
              {filteredSalesRepCount} rep{filteredSalesRepCount !== 1 ? 's' : ''}
            </span>
            <span className="text-black/30">·</span>
            <span className="text-black/40">
              {filteredClientCount} client{filteredClientCount !== 1 ? 's' : ''}
            </span>
            <button
              onClick={handleSearchClear}
              className="ml-1 rounded px-1.5 py-0.5 text-[9px] text-black/40 transition-colors hover:bg-black/5 hover:text-black/70"
            >
              show all
            </button>
          </div>
        )}
      </div>

      {/* Auto-rotate toggle */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-xl border border-black/10 bg-[#f5f0e8]/80 px-3 py-2 backdrop-blur-sm">
        <input
          type="checkbox"
          id="auto-rotate"
          checked={autoRotate}
          onChange={e => setAutoRotate(e.target.checked)}
          className="h-3 w-3 cursor-pointer accent-black/60"
        />
        <label htmlFor="auto-rotate" className="cursor-pointer select-none font-mono text-[10px] text-black/50">
          Auto rotate
        </label>
      </div>

      {/* Legend */}
      <Legend />

      {/* Title */}
      <div className="absolute left-4 top-4 z-10">
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-black/60">
          Cybernetic · Neural Network
        </p>
        {loadingDone && (
          <p className="mt-0.5 font-mono text-[9px] text-black/20">
            {displayData.nodes.length} nodes · {displayData.links.length} links
          </p>
        )}
      </div>

      {/* 3D Graph */}
      {dimensions.width > 0 && (
        <ForceGraph3D
          ref={fgRef}
          graphData={displayData as never}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor={BG_COLOR}
          nodeThreeObject={nodeThreeObject as never}
          nodeThreeObjectExtend={true}
          nodeColor={getNodeColor as never}
          nodeOpacity={0.85}
          nodeResolution={16}
          linkDirectionalParticles={getLinkParticles as never}
          linkDirectionalParticleSpeed={getLinkParticleSpeed as never}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleColor={getLinkParticleColor}
          linkColor={() => 'rgba(110,110,110,0.25)'}
          linkWidth={0.4}
          linkOpacity={0.5}
          onNodeClick={handleNodeClick as never}
          onBackgroundClick={handleBackgroundClick}
          enableNodeDrag
          cooldownTicks={120}
          d3AlphaDecay={0.015}
          d3VelocityDecay={0.3}
        />
      )}
    </div>
  );
}
