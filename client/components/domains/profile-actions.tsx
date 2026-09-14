"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { LogOutIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { PASSWORD_MIN_LENGTH } from "@/lib/api/types"
import { useCellMutation } from "@/features/records/use-cell-mutation"
import { useChangePassword } from "@/features/session/use-change-password"
import { useSession } from "@/features/session/use-session"
import { useSignOut } from "@/features/session/use-sign-out"
import type { UserPreference } from "./profile.config"

const PREFERENCES_ENDPOINT = "/me/preferences"

/** One mutation instance for every editable cell — see notifications-actions. */
const PrefCtx = createContext<ReturnType<typeof useCellMutation<UserPreference>> | null>(null)

export function UserPreferenceProvider({ children }: { children: ReactNode }) {
  const mutation = useCellMutation<UserPreference>(PREFERENCES_ENDPOINT)
  return <PrefCtx.Provider value={mutation}>{children}</PrefCtx.Provider>
}

/**
 * A typed preference value, edited in place.
 *
 * The control follows the declared `type`, and `setPreferenceSchema`'s
 * superRefine — the value must match the type it declares — is mirrored
 * here so a mistyped JSON blob fails before the request rather than as a
 * field error afterwards.
 */
export function PreferenceValueCell({ row }: { row: UserPreference }) {
  const ctx = useContext(PrefCtx)
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState<string | null>(null)
  const busy = ctx?.saving.has(row.key) ?? false

  function save(value: unknown) {
    setInvalid(null)
    void ctx?.write({
      rowKey: row.key,
      method: "put",
      path: `${PREFERENCES_ENDPOINT}/${encodeURIComponent(row.key)}`,
      body: { value, type: row.type },
      optimistic: (rows) => rows.map((r) => (r.key === row.key ? { ...r, value } : r)),
    })
  }

  if (row.type === "boolean") {
    return (
      <Switch
        checked={row.value === true}
        disabled={busy}
        aria-label={`Value of ${row.key}`}
        onCheckedChange={(v) => save(Boolean(v))}
      />
    )
  }

  const text = draft ?? (row.type === "json" ? JSON.stringify(row.value) : String(row.value ?? ""))

  function commit() {
    if (draft == null) return
    if (row.type === "number") {
      const n = Number(draft)
      if (!Number.isFinite(n)) {
        setInvalid("Not a number")
        return
      }
      save(n)
    } else if (row.type === "json") {
      try {
        const parsed: unknown = JSON.parse(draft)
        if (typeof parsed !== "object" || parsed === null) {
          setInvalid("JSON must be an object")
          return
        }
        save(parsed)
      } catch {
        setInvalid("Not valid JSON")
        return
      }
    } else {
      save(draft)
    }
    setDraft(null)
  }

  return (
    <span className="flex flex-col gap-1">
      <Input
        className="h-7 w-56 text-xs"
        aria-label={`Value of ${row.key}`}
        value={text}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") {
            setDraft(null)
            setInvalid(null)
          }
        }}
      />
      {invalid && <span className="text-xs text-destructive">{invalid}</span>}
      {ctx?.failed.get(row.key) && (
        <span className="text-xs text-destructive">{ctx.failed.get(row.key)}</span>
      )}
    </span>
  )
}

/**
 * The account card.
 *
 * Not a table and not a form over a resource — it reads the principal the
 * session already holds, and offers the two things that act on the session
 * itself rather than on any record.
 */
export function AccountPane() {
  const { principal } = useSession()
  const signOut = useSignOut()

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardContent className="flex flex-col gap-1 p-4">
          <CardDescription className="text-xs">Signed in as</CardDescription>
          <CardTitle className="text-lg">
            {principal?.displayName ?? principal?.email ?? "Unknown"}
          </CardTitle>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{principal?.email ?? "—"}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>{principal?.role ?? "—"}</dd>
            <dt className="text-muted-foreground">Principal</dt>
            <dd>{principal?.kind ?? "—"}</dd>
            <dt className="text-muted-foreground">Id</dt>
            <dd className="font-mono">{principal?.id ?? "—"}</dd>
          </dl>
        </CardContent>
      </Card>

      <ChangePassword />

      <div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={signOut}>
          <LogOutIcon className="size-3.5" /> Sign out
        </Button>
      </div>
    </div>
  )
}

function ChangePassword() {
  const { change, busy } = useChangePassword()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setError(null)
    setDone(false)
    const result = await change(current, next, confirm)
    if (!result.ok) {
      setError(result.message ?? "Could not change the password")
      return
    }
    setCurrent("")
    setNext("")
    setConfirm("")
    setDone(true)
  }

  return (
    <Card>
      <CardContent className="p-4">
        <CardTitle className="text-sm">Change password</CardTitle>
        <FieldGroup className="mt-3">
          <Field>
            <FieldLabel htmlFor="pw-current">Current password</FieldLabel>
            <Input
              id="pw-current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pw-next">New password</FieldLabel>
            <Input id="pw-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            <FieldDescription>
              At least {PASSWORD_MIN_LENGTH} characters.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="pw-confirm">Confirm new password</FieldLabel>
            <Input
              id="pw-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        </FieldGroup>

        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            Password changed.
          </p>
        )}

        <Button size="sm" className="mt-3" disabled={busy} onClick={() => void submit()}>
          {busy ? "Changing…" : "Change password"}
        </Button>
      </CardContent>
    </Card>
  )
}
