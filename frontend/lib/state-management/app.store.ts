'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { toast } from 'sonner'
import type { IAppState, IActiveContext, IToast } from '@/lib/interfaces/app.interface'

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_ACTIVE_CONTEXT: IActiveContext = {
  projectId:   null,
  projectSlug: null,
  projectName: null,
}

const INITIAL_STATE = {
  activeContext: INITIAL_ACTIVE_CONTEXT,
  toasts: [] as IToast[],
}

// ─── Store creator ────────────────────────────────────────────────────────────

const appStoreCreator: StateCreator<
  IAppState,
  [['zustand/devtools', never]],
  [],
  IAppState
> = (set) => ({
  ...INITIAL_STATE,

  // ── activeContext slice ────────────────────────────────────────

  setActiveProject: (project: IActiveContext | null) => {
    set(
      { activeContext: project ?? INITIAL_ACTIVE_CONTEXT },
      false,
      project === null ? 'app/setActiveProject/clear' : 'app/setActiveProject',
    )
  },

  clearActiveContext: () =>
    set({ activeContext: INITIAL_ACTIVE_CONTEXT }, false, 'app/clearActiveContext'),

  // ── toast slice ────────────────────────────────────────────────

  addToast: (newToast: Omit<IToast, 'id'>) => {
    const id = crypto.randomUUID()
    const full: IToast = { ...newToast, id }
    set(
      (s) => ({ toasts: [...s.toasts, full] }),
      false,
      'app/addToast',
    )
    const { type, title, description, duration } = full
    toast[type](title, { description, duration })
  },

  removeToast: (id: string) =>
    set(
      (s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }),
      false,
      'app/removeToast',
    ),

  clearToasts: () => set({ toasts: [] }, false, 'app/clearToasts'),
})

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<IAppState>()(
  devtools(appStoreCreator, { name: 'AppStore', enabled: process.env.NODE_ENV === 'development' }),
)

// ─── Selector hooks ───────────────────────────────────────────────────────────

export const useActiveContext    = () => useAppStore((s) => s.activeContext)
export const useSetActiveProject = () => useAppStore((s) => s.setActiveProject)
export const useToasts           = () => useAppStore((s) => s.toasts)
export const useAddToast         = () => useAppStore((s) => s.addToast)
