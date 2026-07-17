'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { knowledgeService } from '@/lib/services/knowledge.service'
import type {
    IKnowledgeState,
    ISearchKnowledgeDto,
    IIngestTextDto,
    IReIngestDto,
    IngestResult,
    IRagQueryDto,
} from '@/lib/interfaces/knowledge.interface'

const INITIAL_STATE = {
    records: [],
    materials: [],
    types: [],
    isLoading: false,
    error: null,
    total: 0,
    page: 1,
    pageSize: 20,
    searchResults: [],
    isSearching: false,
    searchError: null,
}

const knowledgeStoreCreator: StateCreator<
    IKnowledgeState,
    [['zustand/devtools', never]],
    [],
    IKnowledgeState
> = (set, get) => ({
    ...INITIAL_STATE,

    clearError: () => set({ error: null }, false, 'knowledge/clearError'),

    setPage: (page: number) => {
        set({ page }, false, 'knowledge/setPage')
        get().fetchRecords()
    },

    fetchRecords: async (dto: ISearchKnowledgeDto = {}) => {
        set({ isLoading: true, error: null }, false, 'knowledge/fetchRecords/pending')
        try {
            const res = await knowledgeService.searchKnowledge({
                ...dto,
                page: get().page,
                pageSize: get().pageSize,
            })
            const records = Array.isArray(res.data?.records) ? res.data.records : []
            const total = res.data?.total ?? records.length
            set({ records, total, isLoading: false }, false, 'knowledge/fetchRecords/fulfilled')
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Failed to fetch records'
            set({ error: message, isLoading: false }, false, 'knowledge/fetchRecords/rejected')
        }
    },

    fetchMaterials: async () => {
        try {
            const res = await knowledgeService.listMaterials()
            set({ materials: Array.isArray(res.data) ? res.data : [] }, false, 'knowledge/fetchMaterials/fulfilled')
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Failed to fetch materials'
            set({ error: message }, false, 'knowledge/fetchMaterials/rejected')
        }
    },

    fetchTypes: async () => {
        try {
            const res = await knowledgeService.listKnowledgeTypes()
            set({ types: Array.isArray(res.data) ? res.data : [] }, false, 'knowledge/fetchTypes/fulfilled')
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Failed to fetch types'
            set({ error: message }, false, 'knowledge/fetchTypes/rejected')
        }
    },

    ingestText: async (dto: IIngestTextDto) => {
        set({ isLoading: true, error: null }, false, 'knowledge/ingestText/pending')
        try {
            const res = await knowledgeService.ingestText(dto)
            await get().fetchRecords()
            await get().fetchMaterials()
            set({ isLoading: false }, false, 'knowledge/ingestText/fulfilled')
            return { chunksInserted: (res.data as IngestResult).chunksInserted ?? 0 }
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Failed to ingest text'
            set({ error: message, isLoading: false }, false, 'knowledge/ingestText/rejected')
            throw err
        }
    },

    ingestFile: async (formData: FormData) => {
        set({ isLoading: true, error: null }, false, 'knowledge/ingestFile/pending')
        try {
            const res = await knowledgeService.ingestFile(formData)
            await get().fetchRecords()
            await get().fetchMaterials()
            set({ isLoading: false }, false, 'knowledge/ingestFile/fulfilled')
            return { chunksInserted: (res.data as IngestResult).chunksInserted ?? 0 }
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Failed to ingest file'
            set({ error: message, isLoading: false }, false, 'knowledge/ingestFile/rejected')
            throw err
        }
    },

    reIngest: async (dto: IReIngestDto) => {
        set({ isLoading: true, error: null }, false, 'knowledge/reIngest/pending')
        try {
            const res = await knowledgeService.reIngest(dto)
            await get().fetchRecords()
            await get().fetchMaterials()
            set({ isLoading: false }, false, 'knowledge/reIngest/fulfilled')
            return { chunksInserted: (res.data as IngestResult).chunksInserted ?? 0 }
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Failed to re-ingest material'
            set({ error: message, isLoading: false }, false, 'knowledge/reIngest/rejected')
            throw err
        }
    },

    deleteChunk: async (id: number) => {
        set({ isLoading: true, error: null }, false, 'knowledge/deleteChunk/pending')
        try {
            await knowledgeService.deleteChunk(id)
            set(
                (s) => ({ records: s.records.filter((r) => r.id !== id), isLoading: false }),
                false,
                'knowledge/deleteChunk/fulfilled',
            )
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Failed to delete chunk'
            set({ error: message, isLoading: false }, false, 'knowledge/deleteChunk/rejected')
            throw err
        }
    },

    ragQuery: async (dto: IRagQueryDto) => {
        set({ isSearching: true, searchError: null }, false, 'knowledge/ragQuery/pending')
        try {
            const res = await knowledgeService.ragQuery(dto)
            const results = Array.isArray(res.data) ? res.data : []
            set({ searchResults: results, isSearching: false }, false, 'knowledge/ragQuery/fulfilled')
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Vector search failed'
            set({ searchError: message, isSearching: false }, false, 'knowledge/ragQuery/rejected')
        }
    },

    clearSearchResults: () =>
        set({ searchResults: [], searchError: null }, false, 'knowledge/clearSearchResults'),
})

export const useKnowledgeStore = create<IKnowledgeState>()(
    devtools(knowledgeStoreCreator, { name: 'KnowledgeStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useKnowledgeRecords      = () => useKnowledgeStore((s) => s.records)
export const useKnowledgeMaterials    = () => useKnowledgeStore((s) => s.materials)
export const useKnowledgeTypes        = () => useKnowledgeStore((s) => s.types)
export const useKnowledgeLoading      = () => useKnowledgeStore((s) => s.isLoading)
export const useKnowledgeError        = () => useKnowledgeStore((s) => s.error)
export const useKnowledgePage         = () => useKnowledgeStore((s) => s.page)
export const useKnowledgePageSize     = () => useKnowledgeStore((s) => s.pageSize)
export const useKnowledgeSearchResults = () => useKnowledgeStore((s) => s.searchResults)
export const useKnowledgeIsSearching  = () => useKnowledgeStore((s) => s.isSearching)
export const useKnowledgeSearchError  = () => useKnowledgeStore((s) => s.searchError)
