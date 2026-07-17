import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
    IKnowledgeRecord,
    IKnowledgeType,
    IKnowledgeMaterial,
    ISearchKnowledgeDto,
    IIngestTextDto,
    IReIngestDto,
    IngestResult,
    IRagQueryDto,
    IRagQueryResult,
    IRagQueryResponsePayload,
} from '@/lib/interfaces/knowledge.interface'

export const knowledgeService = {
    searchKnowledge(dto: ISearchKnowledgeDto): Promise<IApiResponse<{ records: IKnowledgeRecord[]; total: number }>> {
        return apiClient
            .post<IApiResponse<{ records: IKnowledgeRecord[]; total: number }>>('/rag/knowledge/search', dto)
            .then((r) => r.data)
    },

    ingestText(dto: IIngestTextDto): Promise<IApiResponse<IngestResult>> {
        return apiClient
            .post<IApiResponse<IngestResult>>('/rag/ingest', dto)
            .then((r) => r.data)
    },

    ingestFile(formData: FormData): Promise<IApiResponse<IngestResult>> {
        return apiClient
            .post<IApiResponse<IngestResult>>('/rag/ingest-file', formData, {
                headers: { 'Content-Type': undefined },
            })
            .then((r) => r.data)
    },

    reIngest(dto: IReIngestDto): Promise<IApiResponse<IngestResult>> {
        return apiClient
            .post<IApiResponse<IngestResult>>('/rag/re-ingest', dto)
            .then((r) => r.data)
    },

    deleteChunk(id: number): Promise<IApiResponse<void>> {
        return apiClient
            .post<IApiResponse<void>>('/rag/delete', { id })
            .then((r) => r.data)
    },

    listMaterials(): Promise<IApiResponse<IKnowledgeMaterial[]>> {
        return apiClient
            .get<IApiResponse<IKnowledgeMaterial[]>>('/rag/materials')
            .then((r) => r.data)
    },

    listKnowledgeTypes(): Promise<IApiResponse<IKnowledgeType[]>> {
        return apiClient
            .get<IApiResponse<IKnowledgeType[]>>('/rag/knowledge-types')
            .then((r) => r.data)
    },

    ragQuery(dto: IRagQueryDto): Promise<IApiResponse<IRagQueryResult[]>> {
        // The response interceptor unwraps the backend envelope:
        //   { status:'success', payload: { query, results, contextText } }
        //   → r.data = { data: { query, results, contextText }, message }
        // So the RAG payload lives at r.data.data
        return apiClient
            .post<IApiResponse<IRagQueryResponsePayload>>('/rag/query', dto)
            .then((r) => {
                const payload = r.data.data
                const results: IRagQueryResult[] = (payload?.results ?? []).map((item) => ({
                    ...item.document,
                    score: item.relevanceScore,
                }))
                return { data: results, message: r.data.message }
            })
    },
}
