import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { OpenApiConfig } from '../../config/configurations/openapi.config';
import { buildDocumentConfig } from './openapi.document';
import { OPENAPI_JSON_PATH, OPENAPI_REFERENCE_PATH } from './openapi.constants';

/**
 * Mounts the OpenAPI JSON document and the Scalar reference UI.
 *
 * Both endpoints are served as raw HTTP-adapter routes / middleware, i.e.
 * OUTSIDE the Nest guard pipeline, so the global `JwtAuthGuard` does not block
 * them — the docs are intentionally public (gated only by `OPENAPI_ENABLED`).
 *
 * `cleanupOpenApiDoc` converts the schemas generated from `createZodDto` DTOs
 * into correct OpenAPI. Call this once during bootstrap, before `app.listen()`.
 */
export function setupOpenApi(app: INestApplication): void {
  const cfg = app.get(ConfigService).getOrThrow<OpenApiConfig>('openapi');
  if (!cfg.enabled) {
    return;
  }

  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, buildDocumentConfig(cfg)),
  );

  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get(OPENAPI_JSON_PATH, (_req: Request, res: Response) => {
    res.json(document);
  });

  app.use(OPENAPI_REFERENCE_PATH, apiReference({ content: document }));
}
