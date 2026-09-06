"use client"

/**
 * The `@librechat/client` primitives the SystemCore tree imports, mapped onto
 * our shadcn equivalents.
 *
 * A shim rather than a rewrite of every call site: it keeps the ported files
 * byte-identical to the reference apart from one import line each, so the next
 * upstream change can be diffed rather than reconciled by hand.
 */

export { Button } from "@/components/ui/button"
export { Checkbox } from "@/components/ui/checkbox"
export { Input } from "@/components/ui/input"
export { Label } from "@/components/ui/label"
export { Textarea } from "@/components/ui/textarea"
export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
export { Spinner } from "@/components/ui/spinner"

import { useEffect, useState } from "react"

/**
 * LibreChat's `useMediaQuery`. Ours reads the same way, with the SSR-safe
 * initial `false` Next needs — `window` does not exist during the server pass.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const sync = () => setMatches(mql.matches)
    sync()
    mql.addEventListener("change", sync)
    return () => mql.removeEventListener("change", sync)
  }, [query])

  return matches
}
