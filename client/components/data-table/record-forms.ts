import type { RecordFormSpec } from "./record-form-spec"
import { CONTACTS_FORMS } from "./record-forms/contacts.forms"
import { FINANCE_FORMS } from "./record-forms/finance.forms"
import { KNOWLEDGE_FORMS } from "./record-forms/knowledge.forms"
import { NOTIFICATIONS_FORMS } from "./record-forms/notifications.forms"
import { PROFILE_FORMS } from "./record-forms/profile.forms"
import { PROJECTS_FORMS } from "./record-forms/projects.forms"
import { RELATIONS_FORMS } from "./record-forms/relations.forms"

/**
 * Per-domain form specs, keyed by the domain name passed in a record window's
 * props — the same key space as `DomainTableConfig.key`, so one value is the
 * single source for both.
 *
 * Field constraints mirror the backend zod DTOs so a form fails fast instead
 * of round-tripping to a 422.
 *
 * Split across files by domain purely for size: one object here was past 500
 * lines with three domains in it, and Finance alone has nine specs.
 */
export const RECORD_FORMS: Record<string, RecordFormSpec> = {
  ...CONTACTS_FORMS,
  ...FINANCE_FORMS,
  ...KNOWLEDGE_FORMS,
  ...NOTIFICATIONS_FORMS,
  ...PROFILE_FORMS,
  ...PROJECTS_FORMS,
  ...RELATIONS_FORMS,
}
