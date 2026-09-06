// Whether to offer the System Core at all.
//
// WHY THIS IS A REQUEST AND NOT A CALCULATION
// -------------------------------------------
// The client genuinely cannot work this out. `SystemCapabilities` is backend-only
// and is never re-exported through `librechat-data-provider`; `TUser` carries no
// capabilities field; and `useHasAccess` reads the unrelated `PermissionTypes`
// system. Duplicating `user?.role === SystemRoles.ADMIN` here would also diverge
// from the server the moment someone grants ACCESS_ADMIN to another role through
// the existing grants UI — the API would serve them while the button stayed
// hidden. So the server is asked, once.
//
// THE GATE IS ON DISCOVERY, NOT ON THE MODAL
// ------------------------------------------
// This hides the ways *in*. `SystemCoreDialog` stays mounted and stays fully
// functional on the bundled fixture, so the 3D toy remains harmless to anyone who
// reaches it another way while the cluster *data* stays privileged.
//
// Costs one request per session across all three call sites: the query has one
// key and `staleTime: Infinity`, so React Query serves the rest from cache. A
// non-admin gets a 403, which `retry: false` leaves as a single failed request and
// an undefined `data` — so the answer is a clean false.

import { useSystemCoreAvailability } from '@/components/system-core/shims/data-provider';

export default function useSystemCoreAvailable(): boolean {
  const { data } = useSystemCoreAvailability();
  return data?.enabled === true;
}
