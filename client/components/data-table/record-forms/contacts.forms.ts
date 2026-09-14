import {
  contactChannelsConfig,
  contactInteractionsConfig,
  contactRelationshipsConfig,
} from "@/components/domains/relations.config"
import { omitBlank, type RecordFormSpec } from "../record-form-spec"

export const CONTACTS_FORMS: Record<string, RecordFormSpec> = {
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

    // Channels, relationships and interactions exist only beneath a contact
    // and are reachable from nowhere else.
    relations: [
      { key: "channels", label: "Channels", config: contactChannelsConfig },
      { key: "relationships", label: "Relationships", config: contactRelationshipsConfig },
      { key: "interactions", label: "Interactions", config: contactInteractionsConfig },
    ],
  },

  // Mirrors createCompanySchema / updateCompanySchema in
  // api/src/features/contacts/dto/company.dto.ts
  companies: {
    fields: [
      { key: "name", label: "Name", kind: "text", maxLength: 255, required: true },
      { key: "legalName", label: "Legal name", kind: "text", maxLength: 255 },
      {
        key: "domain",
        label: "Domain",
        kind: "text",
        maxLength: 255,
        help: "Lowercased by the server; the natural key for email-domain matching.",
      },
      { key: "industry", label: "Industry", kind: "text", maxLength: 120 },
      {
        key: "size",
        label: "Size",
        kind: "select",
        options: [
          { value: "micro", label: "Micro" },
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
          { value: "enterprise", label: "Enterprise" },
        ],
      },
      { key: "website", label: "Website", kind: "text", maxLength: 255 },
      { key: "phone", label: "Phone", kind: "tel", maxLength: 40 },
      {
        key: "country",
        label: "Country",
        kind: "text",
        maxLength: 2,
        help: "Two-letter code.",
      },
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
      { key: "taxNumber", label: "Tax number", kind: "text", maxLength: 60 },
      { key: "description", label: "Description", kind: "textarea", maxLength: 20_000 },
    ],
    validate: (v) => (v.name?.trim() ? null : "A company needs a name"),
    serialize: omitBlank,
  },

  // Both vocabulary schemas take the same shape; `key` is createOnly in each
  // because the update schemas omit it — it is immutable once set.
  "contact-types": {
    fields: [
      { key: "name", label: "Name", kind: "text", maxLength: 120, required: true },
      {
        key: "key",
        label: "Key",
        kind: "text",
        createOnly: true,
        help: "Derived from the name when left blank. Cannot be changed later.",
      },
      { key: "description", label: "Description", kind: "textarea", maxLength: 500 },
      { key: "color", label: "Colour", kind: "text", maxLength: 16 },
      { key: "sortOrder", label: "Sort order", kind: "text" },
    ],
    validate: (v) => (v.name?.trim() ? null : "A type needs a name"),
    serialize: omitBlank,
  },

  "contact-categories": {
    fields: [
      { key: "name", label: "Name", kind: "text", maxLength: 120, required: true },
      {
        key: "key",
        label: "Key",
        kind: "text",
        createOnly: true,
        help: "Derived from the name when left blank. Cannot be changed later.",
      },
      { key: "description", label: "Description", kind: "textarea", maxLength: 500 },
      { key: "sortOrder", label: "Sort order", kind: "text" },
    ],
    validate: (v) => (v.name?.trim() ? null : "A category needs a name"),
    serialize: omitBlank,
  },
}
