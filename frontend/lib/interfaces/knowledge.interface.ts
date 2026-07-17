// ─── Entities ────────────────────────────────────────────────────────────────

export interface IKnowledgeRecord {
    id: number
    slug: string
    knowledgeUuid: string
    rawData: string
    materialName: string
    chunkId: number | null
    summary: string | null
    tags: string[] | null
    userId: number
    typeId: number
    createdAt: string | null
    updatedAt: string | null
    isDeleted: boolean | null
}

export interface IKnowledgeType {
    id: number
    slug: string
    name: string
    description: string | null
}

export interface IKnowledgeMaterial {
    materialName: string
    typeId: number
    chunkCount: number
    tags: string[] | null
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface ISearchKnowledgeDto {
    q?: string
    typeId?: number
    materialName?: string
    page?: number
    pageSize?: number
}

export interface IIngestTextDto {
    rawText: string
    materialName: string
    typeId: number
    tags?: string[]
    chunkSize?: number
    chunkOverlap?: number
}

export interface IReIngestDto {
    materialName: string
    rawText: string
    typeId: number
    tags?: string[]
    chunkSize?: number
    chunkOverlap?: number
}

export type IngestResult = { chunksInserted: number; materialName: string }

// ─── RAG / Vector Search ──────────────────────────────────────────────────────

export interface IRagQueryDto {
    query: string
    topK?: number
    typeId?: number
    candidateMultiplier?: number
}

export interface IRagQueryResult {
    id?: number
    slug?: string
    rawData: string
    materialName: string
    chunkId: number | null
    summary?: string | null
    tags?: string[] | null
    userId?: number
    typeId?: number
    /** relevanceScore from the reranker */
    score?: number
    /** raw cosine distance from vector search */
    distance?: number
    createdAt?: string | null
}

/** Shape of each entry in payload.results[] returned by POST /rag/query */
export interface IRagQueryResultItem {
    index: number
    relevanceScore: number
    document: {
        id: number
        slug: string
        rawData: string
        materialName: string
        chunkId: number | null
        summary: string | null
        tags: string[] | null
        userId: number
        typeId: number
        distance: number
    }
}

/** Full envelope returned by POST /rag/query */
export interface IRagQueryResponsePayload {
    query: string
    results: IRagQueryResultItem[]
    contextText: string
}

// ─── Store ───────────────────────────────────────────────────────────────────

export interface IKnowledgeState {
    records: IKnowledgeRecord[]
    materials: IKnowledgeMaterial[]
    types: IKnowledgeType[]
    isLoading: boolean
    error: string | null
    total: number
    page: number
    pageSize: number

    // Vector search state
    searchResults: IRagQueryResult[]
    isSearching: boolean
    searchError: string | null

    clearError: () => void
    setPage: (page: number) => void
    fetchRecords: (dto?: ISearchKnowledgeDto) => Promise<void>
    fetchMaterials: () => Promise<void>
    fetchTypes: () => Promise<void>
    ingestText: (dto: IIngestTextDto) => Promise<{ chunksInserted: number }>
    ingestFile: (formData: FormData) => Promise<{ chunksInserted: number }>
    reIngest: (dto: IReIngestDto) => Promise<{ chunksInserted: number }>
    deleteChunk: (id: number) => Promise<void>
    ragQuery: (dto: IRagQueryDto) => Promise<void>
    clearSearchResults: () => void
}
