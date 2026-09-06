// How a domain's health reads on its band.
//
// Shape matches the reference's STATUS contract — `{ color, gain }` consumed by
// scene/resolve.ts — but the keys are health states rather than the reference's
// user-authored module statuses, because our strips are bound to live feature
// domains (design 4.2), not to hand-edited fixture rows.
//
// `hex` exists so a legend outside the canvas can show the colours actually on
// screen. It is the single sanctioned bridge across the boundary palette.ts
// draws; see that file's header.

export type Health = "unknown" | "nominal" | "active" | "attention" | "error"

export interface StatusSpec {
  /** Emissive colour for the band. */
  color: number
  /** Emissive scaling. Running is the common case and reads too hot at full
   *  strength with eight bands on screen. */
  gain: number
  /** Multiplier on the module's base rotation speed. */
  speed: number
  /** CSS hex, for legends rendered outside the canvas. */
  hex: string
  label: string
}

export const STATUS: Record<Health, StatusSpec> = {
  // Not loaded yet, or signed out. Dim and slow, so the stack resolves into
  // life as the counts land rather than flashing a wrong colour first — but not
  // *dark*: at 0x2a2a35/0.35 the bands rendered as near-black against the stage
  // and the machine read as broken rather than dormant. Verified in a browser.
  unknown: { color: 0x46536b, gain: 0.62, speed: 0.15, hex: "#46536B", label: "Unknown" },
  // Reachable, nothing pending. The resting state, deliberately cool and dim.
  nominal: { color: 0x6f8fa8, gain: 0.85, speed: 1, hex: "#6F8FA8", label: "Nominal" },
  // Work in flight.
  active: { color: 0x7fd4c1, gain: 1.35, speed: 1.9, hex: "#7FD4C1", label: "Active" },
  // Pending approvals, failed ingests, overdue tasks.
  attention: { color: 0xd8a24a, gain: 1.5, speed: 0.7, hex: "#D8A24A", label: "Attention" },
  // The endpoint answered non-2xx.
  error: { color: 0xc2603f, gain: 1.6, speed: 0.25, hex: "#C2603F", label: "Error" },
}

export const STATUS_KEYS = Object.keys(STATUS) as Health[]
