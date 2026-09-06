import { omitBlank, type RecordFormSpec } from "./record-form"

/**
 * Per-domain form specs, keyed by the domain name passed in a record window's
 * props.
 *
 * Field constraints mirror the backend zod DTOs so the form fails fast instead
 * of round-tripping to a 422.
 */
export const RECORD_FORMS: Record<string, RecordFormSpec> = {
  // Mirrors createContactSchema / updateContactSchema in
  // api/src/features/contacts/dto/contact.dto.ts
  contacts: {
    fields: [
      { key: "firstName", label: "First name", kind: "text", maxLength: 120 },
      { key: "lastName", label: "Last name", kind: "text", maxLength: 120 },
      {
        key: "displayName",
        label: "Display name",
        kind: "text",
        maxLength: 255,
        help: "Derived from the name parts when left blank.",
      },
      { key: "primaryEmail", label: "Email", kind: "email", maxLength: 320 },
      { key: "primaryPhone", label: "Phone", kind: "tel", maxLength: 40 },
      { key: "jobTitle", label: "Job title", kind: "text", maxLength: 150 },
      {
        key: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
          { value: "archived", label: "Archived" },
          { value: "do_not_contact", label: "Do not contact" },
        ],
      },
      {
        key: "visibility",
        label: "Visibility",
        kind: "select",
        help: "Private unless you deliberately share it.",
        options: [
          { value: "private", label: "Private" },
          { value: "shared", label: "Shared" },
        ],
      },
      { key: "notes", label: "Notes", kind: "textarea", maxLength: 20_000 },
    ],

    // The DTO's own .refine(): "Provide a name or an email address". Mirrored
    // so the user is told before the request, not after a 422.
    validate: (v) =>
      v.displayName?.trim() || v.firstName?.trim() || v.lastName?.trim() || v.primaryEmail?.trim()
        ? null
        : "Provide a name or an email address",

    serialize: omitBlank,
  },
}
