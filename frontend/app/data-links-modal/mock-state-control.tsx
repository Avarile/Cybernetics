'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'started' | 'operating' | 'done';

export interface TaskNode {
  id: string;
  group: number;
}

export interface Task {
  id: number;
  name: string;
  startOffset: number;
  scheduledLabel: string;
  node: TaskNode;
  status: TaskStatus;
}

export interface MockSearchState {
  /** Non-null = NodeSearch should imperatively select this node */
  node: TaskNode | null;
}

interface MockStateContextType {
  tasks: Task[];
  logs: string[];
  activeTask: Task | null;
  nextPending: Task | null;
  countdown: number | null;
  mockSearch: MockSearchState;
}

// ─── Task config ──────────────────────────────────────────────────────────────

const TASK_CONFIGS: Omit<Task, 'status'>[] = [
  { id: 1, name: 'Initialize Database',  startOffset: 0,  scheduledLabel: '00:00', node: { id: 'FluxFin Works',      group: 1 } },
  { id: 2, name: 'Sync User Data',       startOffset: 30, scheduledLabel: '00:30', node: { id: 'VexData Corp',       group: 1 } },
  { id: 3, name: 'Generate Reports',     startOffset: 60, scheduledLabel: '01:00', node: { id: 'KnoxMed Consulting', group: 1 } },
  { id: 4, name: 'Deploy Updates',       startOffset: 90, scheduledLabel: '01:30', node: { id: 'MindMine Capital',   group: 1 } },
  { id: 5, name: 'Send Notifications',   startOffset: 120, scheduledLabel: '02:00', node: { id: 'CoreAgri Analytics', group: 1 } },
];

// ─── Task log lines ───────────────────────────────────────────────────────────
// 4 lines per task; emitted at delta 1–4 (operating phase)

const TASK_LOGS: Record<number, string[]> = {
  1: [
    '\x1b[36m  ▶\x1b[0m Connecting to database...',
    '\x1b[33m  ⚡\x1b[0m Running migrations...',
    '\x1b[33m  ⚡\x1b[0m Creating indexes...',
    '\x1b[32m  ✓\x1b[0m Database initialized successfully',
  ],
  2: [
    '\x1b[36m  ▶\x1b[0m Fetching user records...',
    '\x1b[33m  ⚡\x1b[0m Processing 1,247 users...',
    '\x1b[33m  ⚡\x1b[0m Resolving conflicts...',
    '\x1b[32m  ✓\x1b[0m User data synced (1,247 records)',
  ],
  3: [
    '\x1b[36m  ▶\x1b[0m Aggregating metrics...',
    '\x1b[33m  ⚡\x1b[0m Generating PDF reports...',
    '\x1b[33m  ⚡\x1b[0m Uploading to storage...',
    '\x1b[32m  ✓\x1b[0m 12 reports generated',
  ],
  4: [
    '\x1b[36m  ▶\x1b[0m Building artifacts...',
    '\x1b[33m  ⚡\x1b[0m Running health checks...',
    '\x1b[33m  ⚡\x1b[0m Swapping deployment slot...',
    '\x1b[32m  ✓\x1b[0m Deployed v2.4.1 successfully',
  ],
  5: [
    '\x1b[36m  ▶\x1b[0m Preparing notification batch...',
    '\x1b[33m  ⚡\x1b[0m Sending to 3,891 subscribers...',
    '\x1b[33m  ⚡\x1b[0m Processing delivery receipts...',
    '\x1b[32m  ✓\x1b[0m All notifications delivered',
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TOTAL_DURATION = TASK_CONFIGS[TASK_CONFIGS.length - 1].startOffset + 6;

function getStatus(startOffset: number, elapsed: number): TaskStatus {
  const delta = elapsed - startOffset;
  if (delta < 0)  return 'pending';
  if (delta === 0) return 'started';
  if (delta < 5)  return 'operating';
  return 'done';
}

// ─── Context ──────────────────────────────────────────────────────────────────

const MockStateContext = createContext<MockStateContextType>({
  tasks: [],
  logs: [],
  activeTask: null,
  nextPending: null,
  countdown: null,
  mockSearch: { node: null },
});

export function useMockState(): MockStateContextType {
  return useContext(MockStateContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function MockStateProvider({ children }: { children: ReactNode }) {
  const [elapsed, setElapsed]       = useState(0);
  const [logs, setLogs]             = useState<string[]>([]);
  const [mockSearch, setMockSearch] = useState<MockSearchState>({ node: null });

  // ── 1 s simulation clock ──────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(e => (e >= TOTAL_DURATION ? 0 : e + 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Reset on loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (elapsed === 0) {
      setLogs([]);
      setMockSearch({ node: null });
    }
  }, [elapsed]);

  // ── Emit logs + drive search mock on each tick ────────────────────────────
  useEffect(() => {
    for (const cfg of TASK_CONFIGS) {
      const delta = elapsed - cfg.startOffset;

      if (delta === 0) {
        setLogs(prev => [
          ...prev,
          `\x1b[1m\x1b[34m[${cfg.name}]\x1b[0m Starting...`,
        ]);
        setMockSearch({ node: cfg.node });
      } else if (delta >= 1 && delta <= 4) {
        const line = TASK_LOGS[cfg.id]?.[delta - 1];
        if (line) setLogs(prev => [...prev, line]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  // ── Derived values ────────────────────────────────────────────────────────
  const tasks: Task[] = TASK_CONFIGS.map(cfg => ({
    ...cfg,
    status: getStatus(cfg.startOffset, elapsed),
  }));

  const activeTask  = tasks.find(t => t.status === 'started' || t.status === 'operating') ?? null;
  const nextPending = tasks.find(t => t.status === 'pending') ?? null;
  const countdown   = nextPending ? nextPending.startOffset - elapsed : null;

  return (
    <MockStateContext.Provider value={{ tasks, logs, activeTask, nextPending, countdown, mockSearch }}>
      {children}
    </MockStateContext.Provider>
  );
}
