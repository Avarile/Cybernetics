import { knowledgeGrantsConfig } from "@/components/domains/relations.config"
import { omitBlank, type RecordFormSpec } from "../record-form-spec"

export const KNOWLEDGE_FORMS: Record<string, RecordFormSpec> = {
  // Mirrors createKnowledgeSchema / updateKnowledgeSchema in
  // api/src/features/knowledge/dto/knowledge.dto.ts
  //
  // `status` is DELIBERATELY absent. It moves through
  // POST /knowledge/:id/status, which enforces a transition table; a field
  // here would offer five targets and let the server reject four, and would
  // imply a PATCH can set it. See knowledge-actions.tsx.
  knowledge: {
    fields: [
      { key: "title", label: "Title", kind: "text", maxLength: 500, required: true },
      {
        key: "slug",
        label: "Slug",
        kind: "text",
        maxLength: 255,
        createOnly: true,
        help: "Lowercase-with-dashes. Derived from the title when left blank.",
      },
      { key: "summary", label: "Summary", kind: "textarea", maxLength: 1000 },
      { key: "body", label: "Body", kind: "textarea", maxLength: 2_000_000 },
      {
        key: "format",
        label: "Format",
        kind: "select",
        options: [
          { value: "markdown", label: "Markdown" },
          { value: "html", label: "HTML" },
          { value: "plain", label: "Plain text" },
          { value: "link", label: "Link" },
          { value: "file", label: "File" },
        ],
      },
      {
        key: "visibility",
        label: "Visibility",
        kind: "select",
        help: "Private unless you deliberately share it.",
        options: [
          { value: "private", label: "Private" },
          { value: "restricted", label: "Restricted" },
          { value: "internal", label: "Internal" },
        ],
      },
      { key: "sourceUrl", label: "Source URL", kind: "text", maxLength: 2000 },
      { key: "language", label: "Language", kind: "text", maxLength: 16 },
      { key: "reviewDueAt", label: "Review due", kind: "date" },
      { key: "expiresAt", label: "Expires", kind: "date" },
      {
        key: "status",
        label: "Status",
        kind: "text",
        readOnly: true,
        help: "Changed through the row menu, which offers only the legal transitions.",
      },
      {
        key: "version",
        label: "Version",
        kind: "text",
        readOnly: true,
        help: "Sent back as a concurrency check, so a colleague's edit is never overwritten.",
      },
    ],
    validate: (v) => (v.title?.trim() ? null : "An article needs a title"),
    serialize: (v) => {
      // `status` is read-only in the form and is NOT in updateKnowledgeSchema
      // — it moves through POST /knowledge/:id/status. Sending it would be
      // rejected by the DTO's strict shape.
      const rest = { ...v }
      const version = rest.version
      delete rest.version
      delete rest.status
      const body = omitBlank(rest)
      // Optimistic concurrency: the server compares this against the row and
      // 409s if it moved. Only meaningful on update — on create there is no
      // version yet and omitBlank has already dropped the empty string.
      const expected = Number(version)
      if (Number.isInteger(expected) && expected > 0) body.expectedVersion = expected
      return body
    },
    relations: [{ key: "grants", label: "Access", config: knowledgeGrantsConfig }],
  },

  "knowledge-types": {
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
      { key: "icon", label: "Icon", kind: "text", maxLength: 60 },
      { key: "color", label: "Colour", kind: "text", maxLength: 16 },
      {
        key: "defaultReviewIntervalDays",
        label: "Review interval (days)",
        kind: "text",
        help: "Drives reviewDueAt — a policy is re-checked, a note is not.",
      },
      { key: "sortOrder", label: "Sort order", kind: "text" },
    ],
    validate: (v) => (v.name?.trim() ? null : "A type needs a name"),
    serialize: omitBlank,
  },

  "knowledge-categories": {
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
