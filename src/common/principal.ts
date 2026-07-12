/** The acting principal. `id === null` denotes the system / internal caller. */
export interface Principal {
  id: string | null;
}

/** System principal for internal (agent / pipeline) callers. */
export const SYSTEM_PRINCIPAL: Principal = { id: null };
