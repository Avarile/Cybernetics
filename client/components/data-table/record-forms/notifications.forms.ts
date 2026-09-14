import { omitBlank, type RecordFormSpec } from "../record-form-spec"

export const NOTIFICATIONS_FORMS: Record<string, RecordFormSpec> = {
  /**
   * Read-only. There is no `GET /notifications/:id`, so this window is
   * SEEDED from the row already in hand — see `RecordWindow.seed`.
   */
  notifications: {
    fields: [
      { key: "subject", label: "Subject", kind: "text", readOnly: true },
      { key: "preview", label: "Preview", kind: "textarea", readOnly: true },
      { key: "status", label: "Delivery status", kind: "text", readOnly: true },
      { key: "entityType", label: "About", kind: "text", readOnly: true },
      { key: "sentAt", label: "Sent", kind: "text", readOnly: true },
      { key: "createdAt", label: "Created", kind: "text", readOnly: true },
    ],
  },

  // Mirrors suppressSchema. POST returns 204, so the form closes on success
  // and relies on invalidation rather than an echoed row.
  suppressions: {
    fields: [
      { key: "email", label: "Address", kind: "email", maxLength: 320, required: true },
      {
        key: "reason",
        label: "Reason",
        kind: "select",
        required: true,
        options: [
          { value: "hard_bounce", label: "Hard bounce" },
          { value: "soft_bounce_repeated", label: "Repeated soft bounces" },
          { value: "complaint", label: "Complaint" },
          { value: "unsubscribe", label: "Unsubscribed" },
          { value: "manual", label: "Manual" },
          { value: "invalid", label: "Invalid address" },
        ],
      },
      { key: "eventKey", label: "Event", kind: "text", maxLength: 120 },
      {
        key: "expiresAt",
        label: "Expires",
        kind: "date",
        help: "Soft bounces expire; a hard bounce should not.",
      },
      { key: "note", label: "Note", kind: "textarea", maxLength: 500 },
    ],
    validate: (v) => {
      if (!v.email?.trim()) return "An address is required"
      if (!v.email.includes("@")) return "That is not an email address"
      if (!v.reason?.trim()) return "Choose a reason"
      return null
    },
    serialize: omitBlank,
  },
}
