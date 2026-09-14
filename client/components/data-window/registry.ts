import type { UserRole } from "@/lib/api/types"
import { contactsDomain } from "@/components/domains/contacts.config"
import { filesDomain } from "@/components/domains/files.config"
import { financeDomain } from "@/components/domains/finance.config"
import { knowledgeDomain } from "@/components/domains/knowledge.config"
import { notificationsDomain } from "@/components/domains/notifications.config"
import { profileDomain } from "@/components/domains/profile.config"
import { projectsDomain } from "@/components/domains/projects.config"
import type { DomainSpec, SectionSpec } from "./types"

/**
 * Every data domain, in sideNav order.
 *
 * Adding a domain is an entry here and a config file — never a window kind, a
 * registry entry and a dock chip. That is the whole point of one `data` window:
 * six domains span ~28 resources, and a window kind each does not scale.
 */
export const DOMAINS: DomainSpec[] = [
  contactsDomain,
  financeDomain,
  projectsDomain,
  knowledgeDomain,
  notificationsDomain,
  filesDomain,
  profileDomain,
]

/** Sections this principal may see. */
export function visibleSections(domain: DomainSpec, role?: UserRole): SectionSpec[] {
  return domain.sections.filter((s) => !s.roles || (role != null && s.roles.includes(role)))
}

/** Domains this principal may see — a domain whose every section is hidden goes too. */
export function visibleDomains(role?: UserRole): DomainSpec[] {
  return DOMAINS.filter(
    (d) =>
      (!d.roles || (role != null && d.roles.includes(role))) &&
      visibleSections(d, role).length > 0,
  )
}

/**
 * Resolve a persisted `{ domain, section }` hint to something renderable.
 *
 * These come out of localStorage, which `isRestorable` deliberately does not
 * validate for props — props are an untyped bag (workspace.store.ts:101). A
 * retired domain key, a section whose `roles` no longer include this principal,
 * or a hand-edited value must degrade to the first visible thing. A blank pane
 * with no error is the one outcome that leaves the user stuck.
 *
 * Returns null only when the principal can see no domain at all.
 */
export function resolveLocation(
  domainKey: unknown,
  sectionKey: unknown,
  role?: UserRole,
): { domain: DomainSpec; section: SectionSpec } | null {
  const domains = visibleDomains(role)
  if (domains.length === 0) return null
  const domain = domains.find((d) => d.key === domainKey) ?? domains[0]
  const sections = visibleSections(domain, role)
  // visibleDomains already guarantees this is non-empty.
  const section = sections.find((s) => s.key === sectionKey) ?? sections[0]
  return { domain, section }
}
