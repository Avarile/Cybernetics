'use client';

import dynamic from 'next/dynamic';
import { MockStateProvider } from '@/app/data-links-modal/mock-state-control';

// react-force-graph-3d uses canvas / browser globals — no SSR
const ForceGraph = dynamic(() => import('./ForceGraph'), { ssr: false });

export function ForceGraphDynamic() {
  return (
    <MockStateProvider>
      <div className="h-full w-full">
        <ForceGraph />
      </div>
    </MockStateProvider>
  );
}
