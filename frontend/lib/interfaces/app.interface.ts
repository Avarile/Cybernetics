export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface IToast {
  id: string
  type: ToastType
  title: string
  description?: string
  duration?: number  // ms; default 4000; 0 = persistent
}

export interface IActiveContext {
  projectId:   number | null
  projectSlug: string | null
  projectName: string | null
}

export interface IAppState {
  // ── Cross-entity context ────────────────────────────────────────
  activeContext: IActiveContext
  setActiveProject: (project: IActiveContext | null) => void
  clearActiveContext: () => void

  // ── Client-side toast feedback ──────────────────────────────────
  toasts: IToast[]
  addToast: (toast: Omit<IToast, 'id'>) => void
  removeToast: (id: string) => void
  clearToasts: () => void
}
