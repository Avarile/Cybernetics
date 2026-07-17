'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';

// react-force-graph-2d uses canvas / browser globals — no SSR
const ForceGraph = dynamic(() => import('./ForceGraph'), { ssr: false });

export function ForceGraphDynamic() {
  const refreshed = useRef(false);

  useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;

    // Force a hard reload on first mount so the 3D graph always starts clean.
    // The flag prevents an infinite reload loop.
    if (!sessionStorage.getItem('data-links-refreshed')) {
      sessionStorage.setItem('data-links-refreshed', '1');
      window.location.reload();
    } else {
      sessionStorage.removeItem('data-links-refreshed');
    }
  }, []);

  return <ForceGraph />;
}
