/**
 * The SystemCore strings, lifted verbatim from the reference's
 * `client/src/locales/en/translation.json`.
 *
 * The reference calls `useLocalize()` from an i18n layer we do not have. Rather
 * than rewrite every call site, this provides the same interface over a copied
 * English dictionary — so the ported components stay diffable against upstream
 * and the on-screen text is identical.
 *
 * `localize(key, vars)` interpolates {{name}} placeholders the same way.
 */

export const SYSTEM_CORE_EN = {
  com_ui_add: "Add",
  com_ui_copied: "Copied",
  com_ui_delete: "Delete",
  com_ui_loading: "Loading...",
  com_ui_reset: "Reset",
  com_ui_system_core_auto: "auto",
  com_ui_system_core_auto_colour: "Use the status colour",
  com_ui_system_core_channel_health: "health",
  com_ui_system_core_channel_load: "load",
  com_ui_system_core_channel_missing: "not reported",
  com_ui_system_core_channel_rate: "throughput",
  com_ui_system_core_channel_unavailable: "unavailable",
  com_ui_system_core_channels: "Readings",
  com_ui_system_core_comma_separated: "comma separated",
  com_ui_system_core_copy_failed: "Could not copy to the clipboard.",
  com_ui_system_core_copy_json: "Copy JSON",
  com_ui_system_core_live: "Live",
  com_ui_system_core_live_error: "Live data is unavailable.",
  com_ui_system_core_live_field: "Driven by live data",
  com_ui_system_core_live_off: "Example data",
  com_ui_system_core_live_paused: "Paused",
  com_ui_system_core_live_retry: "Retry",
  com_ui_system_core_live_stale: "Updated {{age}} ago",
  com_ui_system_core_locked: "Locked \u2014 unlock it to edit",
  com_ui_system_core_modules: "Modules",
  com_ui_system_core_no_selection: "Select a module to edit it.",
  com_ui_system_core_pairs_hint: "name = number, one per line",
  com_ui_system_core_pin: "pin",
  com_ui_system_core_pin_hint: "Pin the angle it is at now",
  com_ui_system_core_reset_data: "Reset to example data",
  com_ui_system_core_reset_source: "Reset to source data",
  com_ui_system_core_status_degraded: "degraded",
  com_ui_system_core_status_fault: "fault",
  com_ui_system_core_status_init: "initializing",
  com_ui_system_core_status_loading: "loading",
  com_ui_system_core_status_running: "running",
} as const

export type TranslationKeys = keyof typeof SYSTEM_CORE_EN

export function useLocalize() {
  return (key: TranslationKeys | string, vars?: Record<string, string | number>): string => {
    const raw = (SYSTEM_CORE_EN as Record<string, string>)[key as string]
    if (raw == null) return key as string
    if (!vars) return raw
    return raw.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
      vars[name] == null ? m : String(vars[name]),
    )
  }
}

export default useLocalize
