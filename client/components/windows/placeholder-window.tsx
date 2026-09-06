"use client"

/**
 * Stand-in body for windows whose real content arrives in a later phase
 * (terminal → Phase 3, voice → Phase 5). It exists so the window manager can
 * be exercised and reviewed now.
 */
export function PlaceholderWindow({ kind }: { kind?: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="text-center text-sm text-muted-foreground">
        {kind ? `The ${kind} window` : "This window"} is not built yet.
      </p>
    </div>
  )
}
