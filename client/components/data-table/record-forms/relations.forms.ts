import { omitBlank, type RecordFormSpec } from "../record-form-spec"

/**
 * Forms for the per-record collections.
 *
 * A relation tab that offers "New" needs a spec exactly as a section does —
 * without one the create window renders "No form is configured for …", which
 * is a dead end reached by an ordinary button.
 */
export const RELATIONS_FORMS: Record<string, RecordFormSpec> = {
  // Mirrors addChannelSchema in contacts/dto/contact.dto.ts.
  "contact-channels": {
    fields: [
      {
        key: "kind",
        label: "Kind",
        kind: "select",
        required: true,
        options: [
          { value: "email", label: "Email" },
          { value: "phone", label: "Phone" },
          { value: "mobile", label: "Mobile" },
          { value: "fax", label: "Fax" },
          { value: "website", label: "Website" },
          { value: "linkedin", label: "LinkedIn" },
          { value: "twitter", label: "Twitter" },
          { value: "wechat", label: "WeChat" },
          { value: "whatsapp", label: "WhatsApp" },
          { value: "other", label: "Other" },
        ],
      },
      { key: "value", label: "Value", kind: "text", maxLength: 320, required: true },
      { key: "label", label: "Label", kind: "text", maxLength: 60 },
      {
        key: "isPrimary",
        label: "Primary",
        kind: "select",
        options: [
          { value: "false", label: "No" },
          { value: "true", label: "Yes" },
        ],
      },
    ],
    validate: (v) => {
      if (!v.kind?.trim()) return "Choose a channel kind"
      if (!v.value?.trim()) return "A channel needs a value"
      return null
    },
    serialize: (v) => {
      const body = omitBlank(v)
      if (body.isPrimary != null) body.isPrimary = body.isPrimary === "true"
      return body
    },
  },

  // Mirrors createRelationshipSchema in contacts/dto/graph.dto.ts.
  "contact-relationships": {
    fields: [
      { key: "toContactId", label: "To contact", kind: "text", required: true },
      {
        key: "type",
        label: "Type",
        kind: "select",
        required: true,
        options: [
          { value: "colleague", label: "Colleague" },
          { value: "reports_to", label: "Reports to" },
          { value: "manages", label: "Manages" },
          { value: "spouse", label: "Spouse" },
          { value: "family", label: "Family" },
          { value: "friend", label: "Friend" },
          { value: "referred_by", label: "Referred by" },
          { value: "introduced_by", label: "Introduced by" },
          { value: "advisor_to", label: "Advisor to" },
          { value: "other", label: "Other" },
        ],
      },
      {
        key: "strength",
        label: "Strength",
        kind: "select",
        options: [
          { value: "weak", label: "Weak" },
          { value: "moderate", label: "Moderate" },
          { value: "strong", label: "Strong" },
        ],
      },
      { key: "since", label: "Since", kind: "date" },
      { key: "note", label: "Note", kind: "textarea", maxLength: 500 },
    ],
    validate: (v) => {
      if (!v.toContactId?.trim()) return "Choose the contact this relates to"
      if (!v.type?.trim()) return "Choose a relationship type"
      return null
    },
    serialize: omitBlank,
  },

  // Mirrors createInteractionSchema in contacts/dto/graph.dto.ts.
  "contact-interactions": {
    fields: [
      {
        key: "kind",
        label: "Kind",
        kind: "select",
        required: true,
        options: [
          { value: "email_in", label: "Email in" },
          { value: "email_out", label: "Email out" },
          { value: "call", label: "Call" },
          { value: "meeting", label: "Meeting" },
          { value: "note", label: "Note" },
          { value: "task", label: "Task" },
          { value: "other", label: "Other" },
        ],
      },
      {
        key: "occurredAt",
        label: "When",
        kind: "date",
        help: "The event time, not the time it was recorded. Defaults to now.",
      },
      { key: "subject", label: "Subject", kind: "text", maxLength: 500 },
      { key: "body", label: "Body", kind: "textarea", maxLength: 50_000 },
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "inbound", label: "Inbound" },
          { value: "outbound", label: "Outbound" },
          { value: "internal", label: "Internal" },
        ],
      },
      { key: "durationMinutes", label: "Duration (minutes)", kind: "text" },
    ],
    validate: (v) => (v.kind?.trim() ? null : "Choose an interaction kind"),
    serialize: (v) => {
      const body = omitBlank(v)
      if (body.durationMinutes != null) body.durationMinutes = Number(body.durationMinutes)
      return body
    },
  },

  // Mirrors createGrantSchema, including its superRefine: exactly one
  // grantee per row, matching the CHECK constraint on the table.
  "knowledge-grants": {
    fields: [
      {
        key: "granteeType",
        label: "Grant to",
        kind: "select",
        required: true,
        options: [
          { value: "user", label: "A user" },
          { value: "role", label: "A role" },
          { value: "authenticated", label: "Anyone signed in" },
        ],
      },
      { key: "granteeUserId", label: "User", kind: "text" },
      { key: "granteeRoleId", label: "Role", kind: "text" },
      {
        key: "permission",
        label: "Permission",
        kind: "select",
        options: [
          { value: "read", label: "Read" },
          { value: "comment", label: "Comment" },
          { value: "write", label: "Write" },
          { value: "manage", label: "Manage" },
        ],
      },
      { key: "expiresAt", label: "Expires", kind: "date" },
    ],
    validate: (v) => {
      const user = Boolean(v.granteeUserId?.trim())
      const role = Boolean(v.granteeRoleId?.trim())
      if (v.granteeType === "user" && !(user && !role)) return "Choose exactly one user"
      if (v.granteeType === "role" && !(role && !user)) return "Choose exactly one role"
      if (v.granteeType === "authenticated" && (user || role)) {
        return "“Anyone signed in” takes no user or role"
      }
      return null
    },
    serialize: omitBlank,
  },

  // Mirrors addDependencySchema in projects/dto/task.dto.ts.
  "task-dependencies": {
    fields: [
      { key: "predecessorTaskId", label: "Depends on task", kind: "text", required: true },
      {
        key: "type",
        label: "Type",
        kind: "select",
        options: [
          { value: "finish_to_start", label: "Finish to start" },
          { value: "start_to_start", label: "Start to start" },
          { value: "finish_to_finish", label: "Finish to finish" },
          { value: "start_to_finish", label: "Start to finish" },
        ],
      },
      { key: "lagDays", label: "Lag (days)", kind: "text" },
    ],
    validate: (v) => {
      if (!v.predecessorTaskId?.trim()) return "Choose the task this depends on"
      const lag = v.lagDays?.trim()
      if (lag && (!Number.isInteger(Number(lag)) || Number(lag) < 0 || Number(lag) > 365)) {
        return "Lag must be a whole number of days, 0 to 365"
      }
      return null
    },
    serialize: (v) => {
      const body = omitBlank(v)
      if (body.lagDays != null) body.lagDays = Number(body.lagDays)
      return body
    },
  },
}
