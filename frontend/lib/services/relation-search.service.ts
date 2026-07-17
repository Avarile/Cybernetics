/**
 * Lightweight search helpers used by RelationAutocomplete.
 * Each function hits the relevant entity search endpoint and maps results
 * to IRelationRef { id, slug, displayName }.
 */
import { apiClient } from '@/lib/http/api-client'
import type { IRelationRef } from '@/lib/interfaces/shared.interface'
import type { IContact } from '@/lib/interfaces/contact.interface'
import type { ITask } from '@/lib/interfaces/task.interface'
import type { IProject } from '@/lib/interfaces/project.interface'

interface SearchResponse<T> {
  data: T[]
}

export async function searchContacts(q: string): Promise<IRelationRef[]> {
  try {
    const trimmed = q.trim()
    const res = await apiClient.post<SearchResponse<IContact>>('/contacts/search', {
      ...(trimmed ? { firstName: trimmed } : {}),
      page: 1,
      pageSize: trimmed ? 20 : 100,
      isDeleted: false,
    })
    return (res.data.data ?? []).map((c) => ({
      id: c.id,
      slug: c.slug,
      displayName: `${c.firstName} ${c.lastName}`.trim(),
    }))
  } catch {
    return []
  }
}

export async function searchTasks(q: string): Promise<IRelationRef[]> {
  try {
    const trimmed = q.trim()
    const res = await apiClient.post<SearchResponse<ITask>>('/tasks/search', {
      ...(trimmed ? { name: trimmed } : {}),
      page: 1,
      pageSize: trimmed ? 20 : 100,
      isDeleted: false,
    })
    return (res.data.data ?? []).map((t) => ({
      id: t.id,
      slug: t.slug,
      displayName: t.name,
    }))
  } catch {
    return []
  }
}

export async function searchProjects(q: string): Promise<IRelationRef[]> {
  try {
    const trimmed = q.trim()
    const res = await apiClient.post<SearchResponse<IProject>>('/projects/search', {
      ...(trimmed ? { name: trimmed } : {}),
      page: 1,
      pageSize: trimmed ? 20 : 100,
      isDeleted: false,
    })
    return (res.data.data ?? []).map((p) => ({
      id: p.id,
      slug: p.slug,
      displayName: p.name,
    }))
  } catch {
    return []
  }
}

export async function searchKnowledge(q: string): Promise<IRelationRef[]> {
  try {
    const trimmed = q.trim()
    const res = await apiClient.post<SearchResponse<{ id: number; slug: string; materialName: string }>>('/rag/knowledge/search', {
      q: trimmed,
      page: 1,
      pageSize: trimmed ? 20 : 100,
    })
    return (res.data.data ?? []).map((k) => ({
      id: k.id,
      slug: k.slug,
      displayName: k.materialName,
    }))
  } catch {
    return []
  }
}
