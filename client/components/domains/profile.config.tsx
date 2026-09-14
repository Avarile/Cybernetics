import { UserIcon } from "lucide-react"
import type { DomainTableConfig } from "@/components/data-table/types"
import type { DomainSpec } from "@/components/data-window/types"
import { StatusBadge, TimeCell, dash, type StatusStyle } from "./cells"
import { AccountPane, PreferenceValueCell, UserPreferenceProvider } from "./profile-actions"

export interface AppUser {
  id: string
  email: string
  role: "user" | "admin" | "agent"
  displayName: string | null
  createdAt: string
  lastLoginAt: string | null
}

/** A `user_preferences` row: a typed key/value. */
export interface UserPreference {
  id: string
  key: string
  value: unknown
  type: "string" | "number" | "boolean" | "json"
}

const ROLE_STYLES: Record<string, StatusStyle> = {
  admin: { label: "Admin", variant: "default" },
  user: { label: "User", variant: "secondary" },
  agent: { label: "Agent", variant: "outline" },
}

/**
 * Your preferences — typed key/value, edited in the cell.
 *
 * The value control follows the declared `type`, and the DTO's superRefine
 * (value must match the declared type) is mirrored in the cell so a mistyped
 * JSON blob fails before the request.
 */
export const userPreferencesConfig: DomainTableConfig<UserPreference> = {
  key: "user-preferences",
  title: "Preferences",
  endpoint: "/me/preferences",
  source: "collection",
  searchable: true,
  canCreate: false,
  canEdit: false,
  canDelete: true,
  // DELETE /me/preferences/:key — the path wants the key, not a row id.
  deleteKey: (r) => r.key,
  rowId: (r) => r.key,
  selectable: false,
  emptyMessage: "No preferences set.",
  columns: [
    {
      key: "key",
      header: "Key",
      cell: (r) => <code className="text-xs font-medium">{r.key}</code>,
      hideable: false,
    },
    { key: "type", header: "Type", cell: (r) => dash(r.type) },
    { key: "value", header: "Value", cell: (r) => <PreferenceValueCell row={r} /> },
  ],
}

export const usersConfig: DomainTableConfig<AppUser> = {
  key: "users",
  title: "Users",
  endpoint: "/users",
  canCreate: true,
  canEdit: true,
  canDelete: true,
  emptyMessage: "No users.",
  columns: [
    {
      key: "email",
      header: "Email",
      cell: (r) => <span className="font-medium">{r.email}</span>,
      hideable: false,
    },
    { key: "role", header: "Role", cell: (r) => <StatusBadge value={r.role} map={ROLE_STYLES} /> },
    { key: "displayName", header: "Display name", cell: (r) => dash(r.displayName) },
    { key: "createdAt", header: "Created", cell: (r) => <TimeCell value={r.createdAt} /> },
    { key: "lastLoginAt", header: "Last login", cell: (r) => <TimeCell value={r.lastLoginAt} /> },
  ],
}

export const profileDomain: DomainSpec = {
  key: "profile",
  label: "You",
  icon: UserIcon,
  sections: [
    {
      key: "profile",
      label: "Profile",
      // A resource of one: /me/profile IS the record, with no id in the path.
      body: { kind: "form", endpoint: "/me/profile", spec: "profile" },
    },
    {
      key: "preferences",
      label: "Preferences",
      hint: "Changes save as you make them.",
      body: {
        kind: "table",
        config: userPreferencesConfig,
        titleOf: (r: UserPreference) => r.key,
        wrapper: UserPreferenceProvider,
      },
    },
    {
      key: "account",
      label: "Account",
      body: { kind: "custom", render: () => <AccountPane /> },
    },
    {
      key: "users",
      label: "Users",
      secondary: true,
      roles: ["admin"],
      hint: "Changing a role revokes that user's sessions and cached permissions.",
      body: { kind: "table", config: usersConfig, titleOf: (r: AppUser) => r.email },
    },
  ],
}
