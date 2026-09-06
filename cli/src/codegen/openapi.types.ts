export interface OpenApiParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  schema?: unknown;
}

export interface OpenApiOperation {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: { $ref?: string } }>;
  };
  security?: unknown[];
}

export type OpenApiPathItem = Record<string, OpenApiOperation | undefined>;

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, OpenApiPathItem>;
  components?: { schemas?: Record<string, unknown> };
}

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
