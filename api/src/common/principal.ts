/** Shared role vocabulary (mirrors the `user_role` DB enum). */
export type UserRole = 'guest' | 'user' | 'admin' | 'agent';

/**
 * The acting principal. `id === null` denotes the system / anonymous caller.
 * `role` is optional so existing `{ id }` call sites keep compiling; the auth
 * guard/strategies always populate it, and RolesGuard treats absent as 'guest'.
 */
export interface Principal {
  id: string | null;
  role?: UserRole;
}

/** System principal for internal (agent / pipeline) callers. */
export const SYSTEM_PRINCIPAL: Principal = { id: null, role: 'agent' };

/** Anonymous caller — no token present. */
export const GUEST_PRINCIPAL: Principal = { id: null, role: 'guest' };
