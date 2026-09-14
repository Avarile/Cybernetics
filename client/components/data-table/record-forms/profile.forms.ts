import { omitBlank, type RecordFormSpec } from "../record-form-spec"

/**
 * IANA zones, from the runtime.
 *
 * A Select rather than free text because the notification scheduler reads
 * `timezone` for quiet hours: a typo there does not fail loudly, it just
 * delivers mail at the wrong time forever. The fallback list covers older
 * runtimes without `supportedValuesOf`.
 */
function timezoneOptions(): { value: string; label: string }[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf
  const zones = supported ? supported("timeZone") : ["UTC", "Europe/London", "America/New_York"]
  return zones.map((z) => ({ value: z, label: z }))
}

export const PROFILE_FORMS: Record<string, RecordFormSpec> = {
  // Mirrors updateProfileSchema in api/src/features/users/dto/profile.dto.ts.
  // GET/PATCH /me/profile — a resource of one, with no id in the path.
  profile: {
    fields: [
      { key: "firstName", label: "First name", kind: "text", maxLength: 120 },
      { key: "lastName", label: "Last name", kind: "text", maxLength: 120 },
      { key: "jobTitle", label: "Job title", kind: "text", maxLength: 150 },
      { key: "department", label: "Department", kind: "text", maxLength: 150 },
      { key: "phone", label: "Phone", kind: "tel", maxLength: 40 },
      {
        key: "timezone",
        label: "Time zone",
        kind: "select",
        options: timezoneOptions(),
        help: "The notification scheduler reads this for quiet hours.",
      },
      {
        key: "locale",
        label: "Locale",
        kind: "text",
        maxLength: 16,
        help: "Selects the notification template; falls back to en.",
      },
      { key: "dateFormat", label: "Date format", kind: "text", maxLength: 32 },
      { key: "timeFormat", label: "Time format", kind: "text", maxLength: 32 },
      { key: "bio", label: "Bio", kind: "textarea", maxLength: 2000 },
    ],
    // The DTO refuses an empty patch.
    validate: (v) =>
      Object.values(v).some((x) => x?.trim()) ? null : "Change at least one field",
    serialize: omitBlank,
  },

  // Mirrors createUserSchema / updateUserSchema. Admin only.
  users: {
    fields: [
      { key: "email", label: "Email", kind: "email", maxLength: 255, createOnly: true, required: true },
      {
        key: "password",
        label: "Password",
        kind: "text",
        help: "At least 12 characters. On an existing user, leave blank to keep the current one.",
      },
      { key: "displayName", label: "Display name", kind: "text", maxLength: 255 },
      {
        key: "role",
        label: "Role",
        kind: "select",
        help: "Changing a role revokes that user's sessions and cached permissions.",
        options: [
          { value: "user", label: "User" },
          { value: "admin", label: "Admin" },
        ],
      },
    ],
    validate: (v) => {
      if (v.email !== undefined && v.email !== "" && !v.email.includes("@")) {
        return "That is not an email address"
      }
      if (v.password?.trim() && (v.password.length < 12 || v.password.length > 200)) {
        return "A password must be 12–200 characters"
      }
      return null
    },
    serialize: omitBlank,
  },
}
