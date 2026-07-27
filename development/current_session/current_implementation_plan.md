# AI Assistant Backend Foundations — Implementation Plan (Part 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four backend gaps the Claude-style AI Assistant UI depends on — a streaming chat endpoint, a conversation-messages endpoint, a document-text-extraction→record pipeline, and an owner-scoped document-search tool — all preserving the existing `agent_run` ledger + HITL approval flow.

**Architecture:** All work is in the NestJS API (`api/`). We reuse the existing `orchestrator` Mastra agent, the `agent_conversation`/`agent_run`/`agent_approval` ledger, `FileService` (MinIO), and `SearchRecordService` (Meili). Streaming is done by consuming Mastra's `agent.stream().fullStream` (an async iterable of `AgentChunkType`) and emitting a small **custom SSE protocol** we define here (the installed `@mastra/core@1.50.1` has no public `toUIMessageStreamResponse`, and `ai` is not a backend dependency). Document ingestion runs as a new BullMQ pipeline that extracts text in-process and persists an owner-scoped record into a new `documents` collection — never through the admin-gated `RecordController`.

**Tech Stack:** NestJS 11 + TypeScript, Jest (`*.spec.ts` co-located), Drizzle ORM (Postgres), BullMQ (Redis), `@mastra/core@1.50.1` / `@mastra/pg@1.15.1` / `@mastra/memory@1.23.0` / `@mastra/nestjs@0.2.6`, Meilisearch (via `SearchEngine`), `nestjs-zod` (`createZodDto`), new deps `mammoth` + `pdf-parse`.

## Global Constraints

- Keep every file under 500 lines. Read a file before editing it.
- No global route prefix and no versioning — controllers mount at literal `@Controller(...)` paths (`api/src/main.ts`). All `/agent/*` and `/files/*` routes sit behind the global `JwtAuthGuard`; use `@CurrentUser() user: Principal` for identity.
- Errors are thrown via the injected `ExceptionService`: `throw this.errors.create(ErrorCode.X, { message?, cause? })`. Never throw a bare `HttpException`.
- DTOs use `nestjs-zod`: `export class XDto extends createZodDto(zSchema) {}`.
- Drizzle repositories extend `BaseRepository` and expose `create`/`findById`; feature-specific reads are added on the repo.
- New npm deps must be CommonJS-compatible (repo pins Meilisearch to CJS; Jest chokes on ESM). `mammoth` and `pdf-parse` are CJS — import `pdf-parse` as `pdf-parse/lib/pdf-parse.js` to avoid its index-file debug harness.
- Collection field specs may NOT use reserved names `id, externalId, collection, createdAt, updatedAt` (auto-managed); at least one field must be `searchable`; only `string`/`string[]` may be `searchable`.
- `MastraModule` must remain the last import in `AppModule`; add `DocumentIngestModule` before it.

## SSE contract (produced by Task 8/9; consumed by the Part-2 frontend plan)

`POST /agent/chat/stream` returns `Content-Type: text/event-stream`. Each event is one line `data: <json>\n\n`, where `<json>` is one of:

```
{ "type": "start",             "conversationId": string, "runId": string }
{ "type": "text-delta",        "delta": string }
{ "type": "reasoning-delta",   "delta": string }
{ "type": "tool-input",        "toolCallId": string, "toolName": string, "args": object }
{ "type": "tool-output",       "toolCallId": string, "toolName": string, "result": unknown, "isError": boolean }
{ "type": "approval-required", "approvalId": string, "toolCallId": string, "toolName": string, "actionType": string, "title": string, "payload": object }
{ "type": "error",             "message": string }
{ "type": "done",              "status": "succeeded" | "awaiting_approval" | "cancelled" | "failed" }
```

Request body: `{ conversationId?: string(uuid), message?: string, resume?: { approvalId: string, approved: boolean } }` (exactly one of `message` or `resume` is required).

---

## File Structure

**New feature module — `api/src/features/document-ingest/`** (owns the doc→record pipeline + the `documents` collection):
- `document-ingest.constants.ts` — queue/job names, `DOCUMENTS_COLLECTION`, ingestable-MIME set + `isIngestableDocMime`, `documentsCollectionFields()`.
- `document-extraction.service.ts` — `DocumentExtractionService.extract(mime, source)` → `{ title?, text }`.
- `documents-collection.bootstrap.ts` — `OnApplicationBootstrap`, creates the `documents` collection if absent.
- `document-ingest.processor.ts` — `@Processor('document-ingest')` consumer: file → extract → persist record.
- `document-ingest.module.ts` — wires the above; imports `FileProcessorModule` + `SearchServiceModule`.

**Modified — `api/src/features/file-processor/`:**
- `file-processing.processor.ts` — after integrity passes, enqueue an `ingest-document` job for ingestable MIME types.
- `file-processor.module.ts` — register the `document-ingest` queue so the processor can inject it.

**New/modified — `api/src/features/mastra/`:**
- `tools/search-documents.tool.ts` (new) — owner-scoped document search tool.
- `agents/orchestrator.agent.ts` (modify) — register the new tool.
- `agents/prompts.ts` (modify) — mention the new tool.
- `services/message-mapper.ts` (new) — pure `toChatMessages(dbMessages)` mapper.
- `services/conversation-messages.service.ts` (new) — reads Mastra store, maps, ownership-checks.
- `services/chunk-to-sse.ts` (new) — pure `chunkToSse(chunk)` translator + `sseFrame(event)`.
- `services/chat-stream.service.ts` (new) — orchestrates streaming (new turn + resume) with ledger + approvals.
- `dto/chat-stream.dto.ts` (new) — request DTO.
- `controllers/chat.controller.ts` (modify) — add `GET /agent/conversations/:id/messages` and `POST /agent/chat/stream`.
- `mastra.module.ts` (modify) — provide `ConversationMessagesService` + `ChatStreamService`.

**Modified — `api/src/app.module.ts`:** import `DocumentIngestModule` (before `MastraModule`).

---

## Task 1: `documents` collection constants + bootstrap

**Files:**
- Create: `api/src/features/document-ingest/document-ingest.constants.ts`
- Create: `api/src/features/document-ingest/documents-collection.bootstrap.ts`
- Test: `api/src/features/document-ingest/documents-collection.bootstrap.spec.ts`

**Interfaces:**
- Consumes: `CollectionService.create(input)` and `CollectionService.get(name)` (from `search-service`; `SearchServiceModule` exports `CollectionService`). `FieldSpec` from `api/src/infrastructure/database/schema/search.schema.ts`.
- Produces: `DOCUMENTS_COLLECTION = 'documents'`, `INGEST_DOCUMENT_QUEUE = 'document-ingest'`, `INGEST_DOCUMENT_JOB = 'ingest-document'`, `isIngestableDocMime(mime): boolean`, `documentsCollectionFields(): FieldSpec[]`, class `DocumentsCollectionBootstrap`.

- [ ] **Step 1: Write the constants file**

```ts
// api/src/features/document-ingest/document-ingest.constants.ts
import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';

export const DOCUMENTS_COLLECTION = 'documents';
export const INGEST_DOCUMENT_QUEUE = 'document-ingest';
export const INGEST_DOCUMENT_JOB = 'ingest-document';

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MARKDOWN_MIME = 'text/markdown';
export const PLAIN_TEXT_MIME = 'text/plain';

const INGESTABLE = new Set<string>([PDF_MIME, DOCX_MIME, MARKDOWN_MIME, PLAIN_TEXT_MIME]);

/** True when an uploaded file's MIME should be extracted into a text record. */
export function isIngestableDocMime(mime: string): boolean {
  return INGESTABLE.has(mime);
}

/**
 * Field spec for the `documents` collection. `createdAt`/`updatedAt`/`externalId`
 * are auto-managed by the search-service, so they are intentionally omitted.
 * Scoping is by `ownerUserId`; `conversationId` is stored for provenance/future use.
 */
export function documentsCollectionFields(): FieldSpec[] {
  return [
    { name: 'title', type: 'string', searchable: true },
    { name: 'text', type: 'string', searchable: true },
    { name: 'fileId', type: 'string', filterable: true },
    { name: 'mimeType', type: 'string', filterable: true },
    { name: 'ownerUserId', type: 'string', filterable: true },
    { name: 'conversationId', type: 'string', filterable: true },
  ];
}
```

- [ ] **Step 2: Write the failing bootstrap test**

```ts
// api/src/features/document-ingest/documents-collection.bootstrap.spec.ts
import { DocumentsCollectionBootstrap } from './documents-collection.bootstrap';
import { DOCUMENTS_COLLECTION } from './document-ingest.constants';

describe('DocumentsCollectionBootstrap', () => {
  const makeCollections = (existing: boolean) => ({
    get: jest.fn().mockImplementation(async (name: string) => {
      if (existing) return { name };
      throw new Error('not found');
    }),
    create: jest.fn().mockResolvedValue({ name: DOCUMENTS_COLLECTION }),
  });

  it('creates the documents collection when it does not exist', async () => {
    const collections = makeCollections(false);
    const boot = new DocumentsCollectionBootstrap(collections as never);
    await boot.onApplicationBootstrap();
    expect(collections.create).toHaveBeenCalledTimes(1);
    expect(collections.create.mock.calls[0][0].name).toBe(DOCUMENTS_COLLECTION);
  });

  it('does not create the collection when it already exists', async () => {
    const collections = makeCollections(true);
    const boot = new DocumentsCollectionBootstrap(collections as never);
    await boot.onApplicationBootstrap();
    expect(collections.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd api && npx jest src/features/document-ingest/documents-collection.bootstrap.spec.ts`
Expected: FAIL — `Cannot find module './documents-collection.bootstrap'`.

- [ ] **Step 4: Write the bootstrap**

```ts
// api/src/features/document-ingest/documents-collection.bootstrap.ts
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { CollectionService } from '../search-service/collection.service';
import { DOCUMENTS_COLLECTION, documentsCollectionFields } from './document-ingest.constants';

/** Idempotently ensures the `documents` collection exists at app start. */
@Injectable()
export class DocumentsCollectionBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocumentsCollectionBootstrap.name);

  constructor(private readonly collections: CollectionService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.collections.get(DOCUMENTS_COLLECTION);
      return; // already exists
    } catch {
      // fall through to create
    }
    try {
      await this.collections.create({
        name: DOCUMENTS_COLLECTION,
        displayName: 'Documents',
        description: 'Extracted text from uploaded documents, searchable by the agent.',
        fields: documentsCollectionFields(),
      });
      this.logger.log(`Created "${DOCUMENTS_COLLECTION}" collection`);
    } catch (error) {
      this.logger.warn(
        `Could not ensure "${DOCUMENTS_COLLECTION}" collection: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd api && npx jest src/features/document-ingest/documents-collection.bootstrap.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/features/document-ingest/
git commit -m "feat(document-ingest): documents collection constants + boot-time bootstrap"
```

---

## Task 2: Document text extraction service

**Files:**
- Create: `api/src/features/document-ingest/document-extraction.service.ts`
- Test: `api/src/features/document-ingest/document-extraction.service.spec.ts`
- Modify: `api/package.json` (add `mammoth`, `pdf-parse`, `@types/pdf-parse`)

**Interfaces:**
- Consumes: `mammoth.extractRawText({ buffer })`, `pdf-parse/lib/pdf-parse.js` default export `(buffer) => Promise<{ text: string }>`; MIME constants from Task 1; `ExceptionService`.
- Produces: `DocumentExtractionService.extract(mimeType: string, source: Readable | Buffer): Promise<{ title?: string; text: string }>`; helper `streamToBuffer(src): Promise<Buffer>`.

- [ ] **Step 1: Add dependencies**

Run: `cd api && pnpm add mammoth pdf-parse && pnpm add -D @types/pdf-parse`
Expected: dependencies added; `pnpm install` succeeds.

- [ ] **Step 2: Write the failing test**

```ts
// api/src/features/document-ingest/document-extraction.service.spec.ts
import { DocumentExtractionService } from './document-extraction.service';
import { DOCX_MIME, MARKDOWN_MIME, PDF_MIME, PLAIN_TEXT_MIME } from './document-ingest.constants';

jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: 'DOCX TEXT' }),
}));
jest.mock('pdf-parse/lib/pdf-parse.js', () =>
  jest.fn().mockResolvedValue({ text: 'PDF TEXT' }),
);

describe('DocumentExtractionService', () => {
  const errors = { create: (_c: unknown, o?: { message?: string }) => new Error(o?.message ?? 'err') };
  const svc = new DocumentExtractionService(errors as never);

  it('extracts plain text and markdown verbatim from a buffer', async () => {
    const md = await svc.extract(MARKDOWN_MIME, Buffer.from('# Title\nbody'));
    expect(md.text).toContain('body');
    const txt = await svc.extract(PLAIN_TEXT_MIME, Buffer.from('hello world'));
    expect(txt.text).toBe('hello world');
  });

  it('extracts docx via mammoth and pdf via pdf-parse', async () => {
    expect((await svc.extract(DOCX_MIME, Buffer.from('x'))).text).toBe('DOCX TEXT');
    expect((await svc.extract(PDF_MIME, Buffer.from('x'))).text).toBe('PDF TEXT');
  });

  it('throws on an unsupported MIME type', async () => {
    await expect(svc.extract('image/png', Buffer.from('x'))).rejects.toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd api && npx jest src/features/document-ingest/document-extraction.service.spec.ts`
Expected: FAIL — `Cannot find module './document-extraction.service'`.

- [ ] **Step 4: Write the extraction service**

```ts
// api/src/features/document-ingest/document-extraction.service.ts
import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import * as mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { ExceptionService } from '../../common/exceptions/exception.service';
import { ErrorCode } from '../../common/exceptions/error-code.enum';
import {
  DOCX_MIME,
  MARKDOWN_MIME,
  PDF_MIME,
  PLAIN_TEXT_MIME,
  isIngestableDocMime,
} from './document-ingest.constants';

export interface ExtractedDocument {
  title?: string;
  text: string;
}

@Injectable()
export class DocumentExtractionService {
  constructor(private readonly errors: ExceptionService) {}

  async extract(mimeType: string, source: Readable | Buffer): Promise<ExtractedDocument> {
    if (!isIngestableDocMime(mimeType)) {
      throw this.errors.create(ErrorCode.FILE_INVALID_STATE, {
        message: `Unsupported document MIME "${mimeType}"`,
      });
    }
    const buffer = Buffer.isBuffer(source) ? source : await streamToBuffer(source);
    switch (mimeType) {
      case PDF_MIME: {
        const parsed = await pdfParse(buffer);
        return { text: parsed.text.trim() };
      }
      case DOCX_MIME: {
        const { value } = await mammoth.extractRawText({ buffer });
        return { text: value.trim() };
      }
      case MARKDOWN_MIME:
      case PLAIN_TEXT_MIME:
      default:
        return { text: buffer.toString('utf8').trim() };
    }
  }
}

export async function streamToBuffer(src: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of src) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
```

Note: confirm `ExceptionService`/`ErrorCode` import paths against a sibling feature (e.g. `grep -rn "exception" api/src/features/file-processor/file.service.ts`) and use the nearest existing `ErrorCode` (e.g. `FILE_INVALID_STATE`) — do not invent a new one.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd api && npx jest src/features/document-ingest/document-extraction.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/features/document-ingest/document-extraction.service.ts api/src/features/document-ingest/document-extraction.service.spec.ts api/package.json api/pnpm-lock.yaml
git commit -m "feat(document-ingest): text extraction for pdf/docx/markdown/plain-text"
```

---

## Task 3: Ingest processor + module

**Files:**
- Create: `api/src/features/document-ingest/document-ingest.processor.ts`
- Create: `api/src/features/document-ingest/document-ingest.module.ts`
- Test: `api/src/features/document-ingest/document-ingest.processor.spec.ts`
- Modify: `api/src/app.module.ts`

**Interfaces:**
- Consumes: `FileService.getMetadata(fileId, owner)` + `FileService.getContentStream(fileId, owner): Promise<Readable>` (exported by `FileProcessorModule`); `DocumentExtractionService.extract`; `SearchRecordService.persist(collection, RecordInput[])` (exported by `SearchServiceModule`); `SYSTEM_PRINCIPAL` from `api/src/common/principal`.
- Produces: `DocumentIngestProcessor` (`@Processor('document-ingest')`, job `'ingest-document'`, data `{ fileId: string }`); `DocumentIngestModule`.

- [ ] **Step 1: Write the failing processor test**

```ts
// api/src/features/document-ingest/document-ingest.processor.spec.ts
import { DocumentIngestProcessor } from './document-ingest.processor';
import { DOCUMENTS_COLLECTION, INGEST_DOCUMENT_JOB } from './document-ingest.constants';

describe('DocumentIngestProcessor', () => {
  const fileRow = {
    id: 'file-1',
    ownerId: 'user-1',
    mimeType: 'text/markdown',
    originalFilename: 'notes.md',
    metadata: { conversationId: 'conv-9' },
  };
  const files = {
    getMetadata: jest.fn().mockResolvedValue(fileRow),
    getContentStream: jest.fn().mockResolvedValue(Buffer.from('# Notes\nbody')),
  };
  const extraction = { extract: jest.fn().mockResolvedValue({ text: 'body', title: 'Notes' }) };
  const records = { persist: jest.fn().mockResolvedValue([{ id: 'rec-1', externalId: 'file-1' }]) };
  const proc = new DocumentIngestProcessor(files as never, extraction as never, records as never);

  it('reads the file, extracts text, and persists a scoped record', async () => {
    await proc.process({ name: INGEST_DOCUMENT_JOB, data: { fileId: 'file-1' } } as never);
    expect(files.getContentStream).toHaveBeenCalledWith('file-1', expect.anything());
    expect(extraction.extract).toHaveBeenCalledWith('text/markdown', expect.anything());
    const [collection, inputs] = records.persist.mock.calls[0];
    expect(collection).toBe(DOCUMENTS_COLLECTION);
    expect(inputs[0].externalId).toBe('file-1');
    expect(inputs[0].document).toMatchObject({
      fileId: 'file-1',
      ownerUserId: 'user-1',
      conversationId: 'conv-9',
      mimeType: 'text/markdown',
      text: 'body',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx jest src/features/document-ingest/document-ingest.processor.spec.ts`
Expected: FAIL — `Cannot find module './document-ingest.processor'`.

- [ ] **Step 3: Write the processor**

```ts
// api/src/features/document-ingest/document-ingest.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SYSTEM_PRINCIPAL } from '../../common/principal';
import { FileService } from '../file-processor/file.service';
import { SearchRecordService } from '../search-service/search-record.service';
import { DocumentExtractionService } from './document-extraction.service';
import {
  DOCUMENTS_COLLECTION,
  INGEST_DOCUMENT_JOB,
  INGEST_DOCUMENT_QUEUE,
} from './document-ingest.constants';

@Processor(INGEST_DOCUMENT_QUEUE)
export class DocumentIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentIngestProcessor.name);

  constructor(
    private readonly files: FileService,
    private readonly extraction: DocumentExtractionService,
    private readonly records: SearchRecordService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== INGEST_DOCUMENT_JOB) return;
    const { fileId } = job.data as { fileId: string };
    // Read/extract as the file owner so ownership checks pass; fall back to system.
    const meta = await this.files.getMetadata(fileId, SYSTEM_PRINCIPAL);
    const owner = { id: meta.ownerId ?? null, role: 'agent' as const };
    const stream = await this.files.getContentStream(fileId, owner);
    const { text, title } = await this.extraction.extract(meta.mimeType, stream);
    const conversationId =
      typeof meta.metadata?.conversationId === 'string' ? meta.metadata.conversationId : undefined;

    await this.records.persist(DOCUMENTS_COLLECTION, [
      {
        externalId: fileId, // idempotent upsert per file
        document: {
          title: title ?? meta.originalFilename,
          text,
          fileId,
          mimeType: meta.mimeType,
          ownerUserId: meta.ownerId ?? '',
          ...(conversationId ? { conversationId } : {}),
        },
      },
    ]);
    this.logger.log(`Ingested file ${fileId} into "${DOCUMENTS_COLLECTION}"`);
  }
}
```

Note: verify `FileService.getMetadata`'s return (`FileMetadata` via `toFileMetadata`) exposes `ownerId`, `mimeType`, `originalFilename`, `metadata`; adjust reads if a field name differs. Confirm `SYSTEM_PRINCIPAL` is exported from `api/src/common/principal`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx jest src/features/document-ingest/document-ingest.processor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the module and register it in AppModule**

```ts
// api/src/features/document-ingest/document-ingest.module.ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FileProcessorModule } from '../file-processor/file-processor.module';
import { SearchServiceModule } from '../search-service/search-service.module';
import { DocumentExtractionService } from './document-extraction.service';
import { DocumentIngestProcessor } from './document-ingest.processor';
import { DocumentsCollectionBootstrap } from './documents-collection.bootstrap';
import { INGEST_DOCUMENT_QUEUE } from './document-ingest.constants';

@Module({
  imports: [
    FileProcessorModule,
    SearchServiceModule,
    BullModule.registerQueue({ name: INGEST_DOCUMENT_QUEUE }),
  ],
  providers: [DocumentExtractionService, DocumentIngestProcessor, DocumentsCollectionBootstrap],
})
export class DocumentIngestModule {}
```

Then add `DocumentIngestModule` to `AppModule`'s `imports` array (read `api/src/app.module.ts` first) — placed **before** `MastraModule` (which must stay last).

- [ ] **Step 6: Run the build**

Run: `cd api && pnpm build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add api/src/features/document-ingest/ api/src/app.module.ts
git commit -m "feat(document-ingest): ingest processor + module wiring"
```

---

## Task 4: Auto-enqueue ingestion after file processing

**Files:**
- Modify: `api/src/features/file-processor/file-processing.processor.ts`
- Modify: `api/src/features/file-processor/file-processor.module.ts`
- Test: `api/src/features/file-processor/file-processing.processor.spec.ts` (extend existing)

**Interfaces:**
- Consumes: `isIngestableDocMime`, `INGEST_DOCUMENT_QUEUE`, `INGEST_DOCUMENT_JOB` (Task 1); `@InjectQueue(INGEST_DOCUMENT_QUEUE)`.
- Produces: after `processFile` leaves a file `AVAILABLE` and integrity passes, an `ingest-document` job `{ fileId }` is enqueued for ingestable MIME types.

- [ ] **Step 1: Write the failing test**

```ts
// add to api/src/features/file-processor/file-processing.processor.spec.ts
it('enqueues an ingest-document job for an ingestable document that passes integrity', async () => {
  const repo = {
    findById: jest.fn().mockResolvedValue({
      id: 'f1', status: 'AVAILABLE', objectKey: 'k', mimeType: 'text/markdown', checksumSha256: null, metadata: {},
    }),
    markStatus: jest.fn().mockResolvedValue({}),
  };
  const storage = { getObjectStream: jest.fn().mockResolvedValue(Buffer.from('hello')) };
  const ingestQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const config = { getOrThrow: () => ({ pendingTtlSeconds: 3600 }) };
  const proc = new FileProcessingProcessor(repo as never, storage as never, config as never, ingestQueue as never);
  await proc.process({ name: 'process-file', data: { fileId: 'f1' } } as never);
  expect(ingestQueue.add).toHaveBeenCalledWith('ingest-document', { fileId: 'f1' }, expect.any(Object));
});
```

(Match the existing spec's fakes — if `getObjectStream` there yields an async iterable, mirror that shape here.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx jest src/features/file-processor/file-processing.processor.spec.ts -t "enqueues an ingest-document"`
Expected: FAIL — constructor arity / `ingestQueue.add` not called.

- [ ] **Step 3: Add the queue dependency and enqueue call**

Read `file-processing.processor.ts`, then add the injected queue and enqueue at the end of `processFile` (after the file is confirmed `AVAILABLE`):

```ts
// imports
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  INGEST_DOCUMENT_JOB,
  INGEST_DOCUMENT_QUEUE,
  isIngestableDocMime,
} from '../../document-ingest/document-ingest.constants';

// constructor — add:
//   @InjectQueue(INGEST_DOCUMENT_QUEUE) private readonly ingestQueue: Queue,

// end of processFile(), after the checksum-backfill block:
    if (!row.checksumSha256) {
      await this.repo.markStatus(fileId, 'AVAILABLE', { checksumSha256: digest });
    }
    if (isIngestableDocMime(row.mimeType)) {
      await this.ingestQueue.add(
        INGEST_DOCUMENT_JOB,
        { fileId },
        { removeOnComplete: true, removeOnFail: 100, attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
      );
    }
```

In `file-processor.module.ts`, add `BullModule.registerQueue({ name: INGEST_DOCUMENT_QUEUE })` to `imports` (import the constant from `../document-ingest/document-ingest.constants`; this is a leaf constants import — no module cycle).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx jest src/features/file-processor/file-processing.processor.spec.ts`
Expected: PASS (existing + new test).

- [ ] **Step 5: Commit**

```bash
git add api/src/features/file-processor/
git commit -m "feat(file-processor): enqueue document ingestion for ingestable uploads"
```

---

## Task 5: `search-documents` agent tool (owner-scoped)

**Files:**
- Create: `api/src/features/mastra/tools/search-documents.tool.ts`
- Modify: `api/src/features/mastra/agents/orchestrator.agent.ts`
- Modify: `api/src/features/mastra/agents/prompts.ts`
- Test: `api/src/features/mastra/tools/search-documents.tool.spec.ts`

**Interfaces:**
- Consumes: `ToolServices` (has `searchRecords: Pick<SearchRecordService,'search'>`); `readRuntime(context)` from `tools/tool-context.ts` (returns `{ principal:{id}, conversationId, runId }`); `createTool` from `@mastra/core/tools`; `DOCUMENTS_COLLECTION` (Task 1); `CuratedSearchResult`/`ToolServices`/`ToolRuntime` from `../mastra.types`.
- Produces: `searchDocumentsExecute(input, deps, rt)` (pure) and `makeSearchDocumentsTool(services)` (Mastra wrapper), tool id `'search-documents'`.

- [ ] **Step 1: Write the failing test**

```ts
// api/src/features/mastra/tools/search-documents.tool.spec.ts
import { searchDocumentsExecute } from './search-documents.tool';
import { DOCUMENTS_COLLECTION } from '../../document-ingest/document-ingest.constants';

describe('searchDocumentsExecute', () => {
  it('scopes the search to the caller and the documents collection', async () => {
    const search = jest.fn().mockResolvedValue({ totalHits: 1, hits: [{ title: 'a' }], facetDistribution: undefined });
    const res = await searchDocumentsExecute(
      { query: 'invoice', topK: 5 },
      { searchRecords: { search } },
      { principal: { id: 'user-1' }, conversationId: 'c1', runId: 'r1' },
    );
    const [collection, req] = search.mock.calls[0];
    expect(collection).toBe(DOCUMENTS_COLLECTION);
    expect(req.filters).toEqual({ ownerUserId: 'user-1' });
    expect(req.q).toBe('invoice');
    expect(res.totalHits).toBe(1);
  });

  it('returns an empty result when there is no principal id', async () => {
    const search = jest.fn();
    const res = await searchDocumentsExecute(
      { query: '', topK: 5 },
      { searchRecords: { search } },
      { principal: { id: null }, conversationId: null, runId: null },
    );
    expect(search).not.toHaveBeenCalled();
    expect(res.totalHits).toBe(0);
    expect(res.hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx jest src/features/mastra/tools/search-documents.tool.spec.ts`
Expected: FAIL — `Cannot find module './search-documents.tool'`.

- [ ] **Step 3: Write the tool**

```ts
// api/src/features/mastra/tools/search-documents.tool.ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DOCUMENTS_COLLECTION } from '../../document-ingest/document-ingest.constants';
import type { CuratedSearchResult, ToolRuntime, ToolServices } from '../mastra.types';
import { readRuntime } from './tool-context';

export const searchDocumentsInput = z.object({
  query: z
    .string()
    .default('')
    .describe('Full-text query over uploaded documents. Pass "" to list the user\'s documents.'),
  topK: z.number().int().positive().max(25).default(10),
});
export type SearchDocumentsInput = z.infer<typeof searchDocumentsInput>;

const MAX_TOP_K = 25;
const EMPTY: CuratedSearchResult = { collection: DOCUMENTS_COLLECTION, totalHits: 0, hits: [] };

/** Pure logic — unit tested. Scopes to the caller's own documents. */
export async function searchDocumentsExecute(
  input: SearchDocumentsInput,
  deps: Pick<ToolServices, 'searchRecords'>,
  rt: ToolRuntime,
): Promise<CuratedSearchResult> {
  if (!rt.principal.id) return EMPTY;
  const limit = Math.min(input.topK ?? 10, MAX_TOP_K);
  const res = await deps.searchRecords.search(DOCUMENTS_COLLECTION, {
    q: input.query ?? '',
    page: 1,
    limit,
    filters: { ownerUserId: rt.principal.id },
  });
  return {
    collection: DOCUMENTS_COLLECTION,
    totalHits: res.totalHits,
    hits: res.hits.slice(0, limit),
    facets: res.facetDistribution,
  };
}

/** Mastra wrapper — not unit tested (imports @mastra). */
export function makeSearchDocumentsTool(services: ToolServices) {
  return createTool({
    id: 'search-documents',
    description:
      'Search the current user\'s uploaded documents (PDF/DOCX/Markdown) by full text and return the ' +
      'top matches. Read-only, automatically scoped to the current user. Pass an EMPTY query to list ' +
      'their documents. Use this to ground answers in files the user has attached or uploaded.',
    inputSchema: searchDocumentsInput,
    outputSchema: z.object({
      collection: z.string(),
      totalHits: z.number(),
      hits: z.array(z.record(z.string(), z.unknown())),
      facets: z.record(z.string(), z.record(z.string(), z.number())).optional(),
    }),
    execute: async (input: SearchDocumentsInput, context: unknown) =>
      searchDocumentsExecute(input, services, readRuntime(context)),
  });
}
```

- [ ] **Step 4: Register the tool + update instructions**

In `orchestrator.agent.ts`, import `makeSearchDocumentsTool` and add to the `tools` map:
```ts
'search-documents': makeSearchDocumentsTool(params.services),
```
In `prompts.ts`, extend the first rule to name the new read tool:
```
- ALWAYS gather facts with the read tools (search-query, search-documents, calculate-metric) before analysis. Use search-documents to consult the user's uploaded files (PDF/DOCX/Markdown). Never invent data.
```

- [ ] **Step 5: Run the test + build to verify they pass**

Run: `cd api && npx jest src/features/mastra/tools/search-documents.tool.spec.ts && pnpm build`
Expected: PASS + build succeeds.

- [ ] **Step 6: Commit**

```bash
git add api/src/features/mastra/tools/search-documents.tool.ts api/src/features/mastra/tools/search-documents.tool.spec.ts api/src/features/mastra/agents/
git commit -m "feat(mastra): owner-scoped search-documents tool + agent wiring"
```

---

## Task 6: Conversation messages endpoint (history rehydration)

**Files:**
- Create: `api/src/features/mastra/services/message-mapper.ts`
- Create: `api/src/features/mastra/services/conversation-messages.service.ts`
- Modify: `api/src/features/mastra/controllers/chat.controller.ts`
- Modify: `api/src/features/mastra/mastra.module.ts` (provide `ConversationMessagesService`)
- Test: `api/src/features/mastra/services/message-mapper.spec.ts`

**Interfaces:**
- Consumes: `ConversationService.getOwned(principal, id)` → row with `id` + `resourceId`; `MastraService.getMastra().getStorage()?.getStore('memory')` → `{ listMessages({ threadId, resourceId }): Promise<{ messages: MastraDBMessage[] }> }`.
- Produces: `ChatMessageDto` type + pure `toChatMessages(dbMessages): ChatMessageDto[]`; `ConversationMessagesService.list(principal, conversationId): Promise<ChatMessageDto[]>`; route `GET /agent/conversations/:id/messages`.

- [ ] **Step 1: Write the failing mapper test**

```ts
// api/src/features/mastra/services/message-mapper.spec.ts
import { toChatMessages } from './message-mapper';

describe('toChatMessages', () => {
  it('maps text, reasoning and tool-invocation parts, dropping step-start', () => {
    const db = [
      { id: 'm1', role: 'user', createdAt: new Date('2026-01-01'), content: { format: 2, parts: [{ type: 'text', text: 'hi' }] } },
      { id: 'm2', role: 'assistant', createdAt: new Date('2026-01-02'), content: { format: 2, parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'thinking' },
        { type: 'tool-invocation', toolInvocation: { state: 'result', toolName: 'search-documents', toolCallId: 't1', args: { query: 'x' }, result: { totalHits: 0 } } },
        { type: 'text', text: 'done' },
      ] } },
    ];
    const out = toChatMessages(db as never);
    expect(out[0]).toMatchObject({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] });
    expect(out[1].parts.map((p) => p.type)).toEqual(['reasoning', 'tool', 'text']);
    const tool = out[1].parts.find((p) => p.type === 'tool') as Record<string, unknown>;
    expect(tool).toMatchObject({ toolName: 'search-documents', toolCallId: 't1', state: 'result' });
    expect(typeof out[1].createdAt).toBe('string');
  });

  it('ignores signal-role messages', () => {
    const db = [{ id: 's', role: 'signal', createdAt: new Date(), content: { format: 2, parts: [] } }];
    expect(toChatMessages(db as never)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx jest src/features/mastra/services/message-mapper.spec.ts`
Expected: FAIL — `Cannot find module './message-mapper'`.

- [ ] **Step 3: Write the mapper**

```ts
// api/src/features/mastra/services/message-mapper.ts
export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; toolCallId: string; toolName: string; state: string; input?: unknown; output?: unknown; errorText?: string }
  | { type: 'source'; sourceId?: string; title?: string; url?: string; mediaType?: string };

export interface ChatMessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
  parts: ChatMessagePart[];
}

/** Minimal structural view of a Mastra stored message (see @mastra/core message-list types). */
interface DbMessageLike {
  id: string;
  role: string;
  createdAt: Date;
  content?: { parts?: Array<Record<string, unknown> & { type: string }> };
}

/** Pure mapper: Mastra stored messages → the frontend chat DTO. */
export function toChatMessages(dbMessages: DbMessageLike[]): ChatMessageDto[] {
  const out: ChatMessageDto[] = [];
  for (const m of dbMessages) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue;
    const parts: ChatMessagePart[] = [];
    for (const part of m.content?.parts ?? []) {
      switch (part.type) {
        case 'text':
          if (typeof part.text === 'string' && part.text.length) parts.push({ type: 'text', text: part.text });
          break;
        case 'reasoning': {
          const text = (part.text as string) ?? (part.reasoning as string) ?? '';
          if (text) parts.push({ type: 'reasoning', text });
          break;
        }
        case 'tool-invocation': {
          const ti = part.toolInvocation as Record<string, unknown>;
          if (ti) {
            parts.push({
              type: 'tool',
              toolCallId: String(ti.toolCallId ?? ''),
              toolName: String(ti.toolName ?? ''),
              state: String(ti.state ?? ''),
              input: ti.args,
              output: ti.result,
              errorText: ti.errorText as string | undefined,
            });
          }
          break;
        }
        case 'source':
        case 'source-url':
        case 'source-document':
          parts.push({
            type: 'source',
            sourceId: part.sourceId as string | undefined,
            title: part.title as string | undefined,
            url: part.url as string | undefined,
            mediaType: part.mediaType as string | undefined,
          });
          break;
        default:
          break; // step-start, file, etc. — ignored in v1
      }
    }
    out.push({ id: m.id, role: m.role, createdAt: m.createdAt.toISOString(), parts });
  }
  return out;
}
```

- [ ] **Step 4: Run the mapper test to verify it passes**

Run: `cd api && npx jest src/features/mastra/services/message-mapper.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the service**

```ts
// api/src/features/mastra/services/conversation-messages.service.ts
import { Injectable } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import type { PrincipalRef } from '../mastra.types';
import { ConversationService } from './conversation.service';
import { toChatMessages, type ChatMessageDto } from './message-mapper';

@Injectable()
export class ConversationMessagesService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly mastra: MastraService,
  ) {}

  async list(principal: PrincipalRef, conversationId: string): Promise<ChatMessageDto[]> {
    const conv = await this.conversations.getOwned(principal, conversationId);
    const store = this.mastra.getMastra().getStorage();
    const memory = await store?.getStore('memory');
    if (!memory) return [];
    const { messages } = await memory.listMessages({
      threadId: conv.id,
      resourceId: conv.resourceId,
    });
    return toChatMessages(messages);
  }
}
```

Note: `getStorage()`/`getStore('memory')`/`listMessages` are the confirmed access path (`@mastra/core` `MastraCompositeStore` + `@mastra/pg` `MemoryPG`). If TS complains about `getStore`'s domain typing, cast the memory store to `{ listMessages(a: { threadId: string; resourceId?: string }): Promise<{ messages: unknown[] }> }`.

- [ ] **Step 6: Add the route + provider**

In `chat.controller.ts`, inject `ConversationMessagesService` and add (import `Param`, `ParseUUIDPipe` from `@nestjs/common`):
```ts
@ApiOperation({ summary: 'Get messages for a conversation' })
@Get('conversations/:id/messages')
messages(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
  return this.messages.list(user, id);
}
```
Add `private readonly messages: ConversationMessagesService` to the constructor; add `ConversationMessagesService` to `mastra.module.ts` `providers`.

- [ ] **Step 7: Build to verify wiring**

Run: `cd api && pnpm build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add api/src/features/mastra/services/message-mapper.ts api/src/features/mastra/services/message-mapper.spec.ts api/src/features/mastra/services/conversation-messages.service.ts api/src/features/mastra/controllers/chat.controller.ts api/src/features/mastra/mastra.module.ts
git commit -m "feat(mastra): GET /agent/conversations/:id/messages history endpoint"
```

---

## Task 7: Chunk → SSE translator (pure)

**Files:**
- Create: `api/src/features/mastra/services/chunk-to-sse.ts`
- Test: `api/src/features/mastra/services/chunk-to-sse.spec.ts`

**Interfaces:**
- Consumes: `AgentChunkType` chunks from `agent.stream().fullStream` — each `{ type, runId, from, payload }`; `ActionType` from `../mastra.types`.
- Produces: `SseEvent` union (matches the SSE contract above); `chunkToSse(chunk): SseEvent | null`; `sseFrame(event): string`; `actionTypeForTool(toolName): ActionType`.

- [ ] **Step 1: Write the failing test**

```ts
// api/src/features/mastra/services/chunk-to-sse.spec.ts
import { chunkToSse, sseFrame, actionTypeForTool } from './chunk-to-sse';

describe('chunkToSse', () => {
  it('maps text and reasoning deltas', () => {
    expect(chunkToSse({ type: 'text-delta', payload: { id: '1', text: 'Hel' } } as never))
      .toEqual({ type: 'text-delta', delta: 'Hel' });
    expect(chunkToSse({ type: 'reasoning-delta', payload: { id: '1', text: 'hmm' } } as never))
      .toEqual({ type: 'reasoning-delta', delta: 'hmm' });
  });

  it('maps tool-call and tool-result', () => {
    expect(chunkToSse({ type: 'tool-call', payload: { toolCallId: 't1', toolName: 'search-documents', args: { q: 'x' } } } as never))
      .toEqual({ type: 'tool-input', toolCallId: 't1', toolName: 'search-documents', args: { q: 'x' } });
    expect(chunkToSse({ type: 'tool-result', payload: { toolCallId: 't1', toolName: 'search-documents', result: { totalHits: 0 }, isError: false } } as never))
      .toEqual({ type: 'tool-output', toolCallId: 't1', toolName: 'search-documents', result: { totalHits: 0 }, isError: false });
  });

  it('ignores chunks with no client-facing mapping', () => {
    expect(chunkToSse({ type: 'step-start', payload: {} } as never)).toBeNull();
    expect(chunkToSse({ type: 'finish', payload: {} } as never)).toBeNull();
  });

  it('frames an event as an SSE data line and maps action types', () => {
    expect(sseFrame({ type: 'done', status: 'succeeded' })).toBe('data: {"type":"done","status":"succeeded"}\n\n');
    expect(actionTypeForTool('send-email')).toBe('send_email');
    expect(actionTypeForTool('db-write')).toBe('db_write');
    expect(actionTypeForTool('mystery')).toBe('other');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx jest src/features/mastra/services/chunk-to-sse.spec.ts`
Expected: FAIL — `Cannot find module './chunk-to-sse'`.

- [ ] **Step 3: Write the translator**

```ts
// api/src/features/mastra/services/chunk-to-sse.ts
import type { ActionType } from '../mastra.types';

export type SseEvent =
  | { type: 'start'; conversationId: string; runId: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-input'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-output'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'approval-required'; approvalId: string; toolCallId: string; toolName: string; actionType: ActionType; title: string; payload: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'done'; status: 'succeeded' | 'awaiting_approval' | 'cancelled' | 'failed' };

/** Map one Mastra fullStream chunk to a client SSE event (or null to drop it). */
export function chunkToSse(chunk: { type: string; payload?: Record<string, unknown> }): SseEvent | null {
  const p = chunk.payload ?? {};
  switch (chunk.type) {
    case 'text-delta':
      return { type: 'text-delta', delta: String(p.text ?? '') };
    case 'reasoning-delta':
      return { type: 'reasoning-delta', delta: String(p.text ?? '') };
    case 'tool-call':
      return { type: 'tool-input', toolCallId: String(p.toolCallId ?? ''), toolName: String(p.toolName ?? ''), args: p.args };
    case 'tool-result':
      return { type: 'tool-output', toolCallId: String(p.toolCallId ?? ''), toolName: String(p.toolName ?? ''), result: p.result, isError: Boolean(p.isError) };
    case 'error':
      return { type: 'error', message: p.error instanceof Error ? p.error.message : String(p.error ?? 'stream error') };
    default:
      return null; // start/step-*/finish/tool-call-approval handled by the service, not streamed verbatim
  }
}

export function sseFrame(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const ACTION_BY_TOOL: Record<string, ActionType> = { 'send-email': 'send_email', 'db-write': 'db_write' };
export function actionTypeForTool(toolName: string): ActionType {
  return ACTION_BY_TOOL[toolName] ?? 'other';
}
```

Note: confirm `ActionType` in `mastra.types.ts` is `'send_email' | 'db_write' | 'external_api' | 'other'` (matches the frontend `mastra.interface.ts`). If it is not exported there, define the union locally in this file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx jest src/features/mastra/services/chunk-to-sse.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/features/mastra/services/chunk-to-sse.ts api/src/features/mastra/services/chunk-to-sse.spec.ts
git commit -m "feat(mastra): pure Mastra-chunk → SSE-event translator"
```

---

## Task 8: Streaming chat endpoint (new turn)

**Files:**
- Create: `api/src/features/mastra/dto/chat-stream.dto.ts`
- Create: `api/src/features/mastra/services/chat-stream.service.ts`
- Modify: `api/src/features/mastra/controllers/chat.controller.ts`
- Modify: `api/src/features/mastra/mastra.module.ts` (provide `ChatStreamService`)
- Test: `api/src/features/mastra/services/chat-stream.service.spec.ts`

**Interfaces:**
- Consumes: `ConversationService.ensure/touch/getOwned`; `AgentRunRepository.create/finish`; `ApprovalRepository.create`; `MastraService.getAgent(AGENT_ID)`; `buildRequestContext` (`services/mastra-adapters`); `chunkToSse`/`sseFrame`/`actionTypeForTool` (Task 7). The agent stub exposes `stream(message, opts): Promise<{ fullStream: AsyncIterable<chunk>; text: Promise<string>; usage: Promise<...>; finishReason: Promise<string> }>`.
- Produces: `ChatStreamDto`; `ChatStreamService.stream(principal, input, sink): Promise<void>` where `sink` is `{ write(frame: string): void }` (the Express `Response`).

- [ ] **Step 1: Write the DTO**

```ts
// api/src/features/mastra/dto/chat-stream.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const chatStreamSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    message: z.string().min(1).max(8000).optional(),
    resume: z.object({ approvalId: z.string().uuid(), approved: z.boolean() }).optional(),
  })
  .refine((v) => Boolean(v.message) !== Boolean(v.resume), {
    message: 'Provide exactly one of `message` or `resume`',
  });

export class ChatStreamDto extends createZodDto(chatStreamSchema) {}
```

- [ ] **Step 2: Write the failing service test (new-turn happy path + suspend path)**

```ts
// api/src/features/mastra/services/chat-stream.service.spec.ts
import { ChatStreamService } from './chat-stream.service';

function fakeOutput(chunks: unknown[], finishReason = 'stop') {
  return {
    fullStream: (async function* () { for (const c of chunks) yield c; })(),
    text: Promise.resolve('final text'),
    usage: Promise.resolve({ inputTokens: 3, outputTokens: 5 }),
    finishReason: Promise.resolve(finishReason),
  };
}
const sink = () => { const frames: string[] = []; return { frames, write: (f: string) => frames.push(f) }; };
const deps = () => ({
  conversations: { ensure: jest.fn().mockResolvedValue({ id: 'conv-1', resourceId: 'user-1' }), touch: jest.fn(), getOwned: jest.fn() },
  runs: { create: jest.fn().mockResolvedValue({ id: 'run-1' }), finish: jest.fn() },
  approvals: { create: jest.fn().mockResolvedValue({ id: 'appr-1' }) },
});

describe('ChatStreamService.stream (new turn)', () => {
  it('streams text deltas, finishes the run, and emits done:succeeded', async () => {
    const { conversations, runs, approvals } = deps();
    const agent = { stream: jest.fn().mockResolvedValue(fakeOutput([
      { type: 'text-delta', runId: 'mr-1', payload: { text: 'Hi ' } },
      { type: 'text-delta', runId: 'mr-1', payload: { text: 'there' } },
    ])) };
    const mastra = { getAgent: () => agent };
    const s = sink();
    const svc = new ChatStreamService(conversations as never, runs as never, approvals as never, mastra as never);
    await svc.stream({ id: 'user-1', role: 'user' }, { message: 'hello' } as never, s as never);
    expect(s.frames[0]).toContain('"type":"start"');
    expect(s.frames.join('')).toContain('"delta":"Hi "');
    expect(runs.finish).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'succeeded' }));
    expect(s.frames.at(-1)).toContain('"status":"succeeded"');
    expect(conversations.touch).toHaveBeenCalledWith('conv-1');
  });

  it('on suspend, creates an approval and emits approval-required + done:awaiting_approval', async () => {
    const { conversations, runs, approvals } = deps();
    const agent = { stream: jest.fn().mockResolvedValue(fakeOutput([
      { type: 'tool-call-approval', runId: 'mr-9', payload: { toolCallId: 'tc-1', toolName: 'send-email', args: { to: 'x@y.z' } } },
    ], 'suspended')) };
    const mastra = { getAgent: () => agent };
    const s = sink();
    const svc = new ChatStreamService(conversations as never, runs as never, approvals as never, mastra as never);
    await svc.stream({ id: 'user-1', role: 'user' }, { message: 'email x' } as never, s as never);
    expect(approvals.create).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'tc-1', mastraRunId: 'mr-9', actionType: 'send_email', status: 'pending' }));
    expect(s.frames.join('')).toContain('"type":"approval-required"');
    expect(runs.finish).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'awaiting_approval' }));
    expect(s.frames.at(-1)).toContain('"status":"awaiting_approval"');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd api && npx jest src/features/mastra/services/chat-stream.service.spec.ts`
Expected: FAIL — `Cannot find module './chat-stream.service'`.

- [ ] **Step 4: Write the service (new-turn path)**

```ts
// api/src/features/mastra/services/chat-stream.service.ts
import { Injectable } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import { AGENT_ID } from '../mastra.constants';
import type { PrincipalRef } from '../mastra.types';
import { AgentRunRepository } from '../repositories/agent-run.repository';
import { ApprovalRepository } from '../repositories/approval.repository';
import { buildRequestContext } from './mastra-adapters';
import { ConversationService } from './conversation.service';
import { actionTypeForTool, chunkToSse, sseFrame, type SseEvent } from './chunk-to-sse';

export interface StreamSink {
  write(frame: string): void;
}
interface StreamInput {
  conversationId?: string;
  message?: string;
  resume?: { approvalId: string; approved: boolean };
}
interface Suspend {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

@Injectable()
export class ChatStreamService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly runs: AgentRunRepository,
    private readonly approvals: ApprovalRepository,
    private readonly mastra: MastraService,
  ) {}

  async stream(principal: PrincipalRef, input: StreamInput, sink: StreamSink): Promise<void> {
    if (input.resume) {
      await this.resume(principal, input.resume, sink);
      return;
    }
    const conv = await this.conversations.ensure(principal, input.conversationId, 'chat');
    const run = await this.runs.create({
      conversationId: conv.id,
      trigger: 'user_message',
      triggeredByUserId: principal.id,
      status: 'running',
      agentId: AGENT_ID,
      input: { message: input.message },
      startedAt: new Date(),
    } as never);
    const emit = (e: SseEvent) => sink.write(sseFrame(e));
    emit({ type: 'start', conversationId: conv.id, runId: run.id });

    try {
      const agent = this.mastra.getAgent(AGENT_ID);
      const output = await agent.stream(input.message as string, {
        memory: { resource: conv.resourceId, thread: { id: conv.id } },
        requestContext: buildRequestContext({ principal, runId: run.id, conversationId: conv.id }),
      } as never);

      const { suspend, mastraRunId } = await this.pump(output as never, emit);
      await this.finishTurn(run.id, conv, output as never, suspend, mastraRunId, emit);
    } catch (err) {
      await this.runs.finish(run.id, {
        status: 'failed',
        error: { message: err instanceof Error ? err.message : String(err) },
        finishedAt: new Date(),
      } as never);
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      emit({ type: 'done', status: 'failed' });
    }
  }

  /** Consume the Mastra stream, forwarding client-facing chunks; capture suspend + runId. */
  private async pump(
    output: { fullStream: AsyncIterable<{ type: string; runId?: string; payload?: Record<string, unknown> }> },
    emit: (e: SseEvent) => void,
  ): Promise<{ suspend: Suspend | null; mastraRunId: string | null }> {
    let suspend: Suspend | null = null;
    let mastraRunId: string | null = null;
    for await (const chunk of output.fullStream) {
      mastraRunId ??= chunk.runId ?? null;
      if (chunk.type === 'tool-call-approval' || chunk.type === 'tool-call-suspended') {
        const p = chunk.payload ?? {};
        suspend = { toolCallId: String(p.toolCallId ?? ''), toolName: String(p.toolName ?? ''), args: (p.args as Record<string, unknown>) ?? {} };
        continue;
      }
      const event = chunkToSse(chunk);
      if (event) emit(event);
    }
    return { suspend, mastraRunId };
  }

  private async finishTurn(
    runId: string,
    conv: { id: string },
    output: { text: Promise<string>; usage: Promise<{ inputTokens?: number; outputTokens?: number }>; finishReason: Promise<string | undefined> },
    suspend: Suspend | null,
    mastraRunId: string | null,
    emit: (e: SseEvent) => void,
  ): Promise<void> {
    const reason = await output.finishReason;
    if (suspend || reason === 'suspended') {
      const s = suspend as Suspend;
      const appr = await this.approvals.create({
        runId,
        conversationId: conv.id,
        mastraRunId,
        toolCallId: s.toolCallId,
        actionType: actionTypeForTool(s.toolName),
        title: `Approve ${s.toolName}`,
        payload: s.args,
        status: 'pending',
      } as never);
      await this.runs.finish(runId, { status: 'awaiting_approval', finishedAt: new Date() } as never);
      emit({ type: 'approval-required', approvalId: appr.id, toolCallId: s.toolCallId, toolName: s.toolName, actionType: actionTypeForTool(s.toolName), title: `Approve ${s.toolName}`, payload: s.args });
      emit({ type: 'done', status: 'awaiting_approval' });
      return;
    }
    const [text, usage] = await Promise.all([output.text, output.usage]);
    await this.runs.finish(runId, {
      status: 'succeeded',
      output: { text },
      tokensInput: usage.inputTokens,
      tokensOutput: usage.outputTokens,
      finishedAt: new Date(),
    } as never);
    await this.conversations.touch(conv.id);
    emit({ type: 'done', status: 'succeeded' });
  }

  // resume(...) is added in Task 9.
  private async resume(_p: PrincipalRef, _r: { approvalId: string; approved: boolean }, _s: StreamSink): Promise<void> {
    throw new Error('not implemented'); // replaced in Task 9
  }
}
```

Note: mirror the exact field names `AgentRunnerService.runChat` passes to `runs.create`/`runs.finish` and `approvals.create` (`mastraRunId`, `tokensInput`, `tokensOutput`, `output`, etc.) — copy them verbatim from `agent-runner.service.ts` if any differ.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd api && npx jest src/features/mastra/services/chat-stream.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire the controller route (manual SSE via `@Res`)**

In `chat.controller.ts`, add (import `Res` from `@nestjs/common`, `Response` type from `express`, inject `ChatStreamService`):
```ts
@ApiOperation({ summary: 'Stream a chat turn (SSE)' })
@Post('chat/stream')
async stream(@CurrentUser() user: Principal, @Body() dto: ChatStreamDto, @Res() res: Response): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  await this.chatStream.stream(user, dto, { write: (f) => res.write(f) });
  res.end();
}
```
Add `ChatStreamService` to `mastra.module.ts` `providers`.

- [ ] **Step 7: Build to verify wiring**

Run: `cd api && pnpm build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add api/src/features/mastra/dto/chat-stream.dto.ts api/src/features/mastra/services/chat-stream.service.ts api/src/features/mastra/services/chat-stream.service.spec.ts api/src/features/mastra/controllers/chat.controller.ts api/src/features/mastra/mastra.module.ts
git commit -m "feat(mastra): POST /agent/chat/stream SSE endpoint (new turn, ledger + approvals)"
```

---

## Task 9: Streaming resume-after-approval

**Files:**
- Modify: `api/src/features/mastra/services/chat-stream.service.ts`
- Test: `api/src/features/mastra/services/chat-stream.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `ApprovalRepository.findById(id)` + `ApprovalRepository.decide(id, patch)`; `ConversationService.getOwned`; `agent.approveToolCall({ runId, toolCallId })` / `agent.declineToolCall({ runId, toolCallId })` (both return a streamable `MastraModelOutput`).
- Produces: `ChatStreamService.resume(...)` streams the continuation and closes the approval + original run.

- [ ] **Step 1: Write the failing resume test**

```ts
// add to api/src/features/mastra/services/chat-stream.service.spec.ts
describe('ChatStreamService.stream (resume)', () => {
  it('approves, streams the continuation, and marks the approval executed', async () => {
    const conversations = { ensure: jest.fn(), touch: jest.fn(), getOwned: jest.fn().mockResolvedValue({ id: 'conv-1', resourceId: 'user-1' }) };
    const runs = { create: jest.fn(), finish: jest.fn() };
    const approvals = {
      findById: jest.fn().mockResolvedValue({ id: 'appr-1', status: 'pending', conversationId: 'conv-1', runId: 'run-1', mastraRunId: 'mr-9', toolCallId: 'tc-1' }),
      decide: jest.fn().mockResolvedValue(undefined),
    };
    const agent = { approveToolCall: jest.fn().mockResolvedValue({
      fullStream: (async function* () { yield { type: 'text-delta', runId: 'mr-9', payload: { text: 'sent!' } }; })(),
      text: Promise.resolve('sent!'), usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }), finishReason: Promise.resolve('stop'),
    }) };
    const mastra = { getAgent: () => agent };
    const frames: string[] = [];
    const svc = new ChatStreamService(conversations as never, runs as never, approvals as never, mastra as never);
    await svc.stream({ id: 'user-1', role: 'user' }, { conversationId: 'conv-1', resume: { approvalId: 'appr-1', approved: true } } as never, { write: (f: string) => frames.push(f) } as never);
    expect(agent.approveToolCall).toHaveBeenCalledWith({ runId: 'mr-9', toolCallId: 'tc-1' });
    expect(frames.join('')).toContain('"delta":"sent!"');
    expect(approvals.decide).toHaveBeenCalledWith('appr-1', expect.objectContaining({ status: 'executed' }));
    expect(runs.finish).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'succeeded' }));
    expect(frames.at(-1)).toContain('"status":"succeeded"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx jest src/features/mastra/services/chat-stream.service.spec.ts -t "resume"`
Expected: FAIL — resume throws `not implemented`.

- [ ] **Step 3: Replace the `resume` stub with the real implementation**

```ts
// replace the placeholder resume(...) in chat-stream.service.ts
  private async resume(
    principal: PrincipalRef,
    resume: { approvalId: string; approved: boolean },
    sink: StreamSink,
  ): Promise<void> {
    const emit = (e: SseEvent) => sink.write(sseFrame(e));
    const appr = await this.approvals.findById(resume.approvalId);
    if (!appr || appr.status !== 'pending') {
      emit({ type: 'error', message: 'Approval not found or already resolved' });
      emit({ type: 'done', status: 'failed' });
      return;
    }
    if (principal.role !== 'admin' && appr.conversationId) {
      await this.conversations.getOwned(principal, appr.conversationId); // throws 403/404
    }
    emit({ type: 'start', conversationId: appr.conversationId as string, runId: appr.runId });
    try {
      const agent = this.mastra.getAgent(AGENT_ID);
      const payload = { runId: appr.mastraRunId as string, toolCallId: appr.toolCallId ?? undefined };
      const output = resume.approved
        ? await agent.approveToolCall(payload as never)
        : await agent.declineToolCall(payload as never);
      const { suspend, mastraRunId } = await this.pump(output as never, emit);

      if (suspend) {
        // A second approval surfaced during the continuation — record it and pause again.
        const next = await this.approvals.create({
          runId: appr.runId, conversationId: appr.conversationId, mastraRunId,
          toolCallId: suspend.toolCallId, actionType: actionTypeForTool(suspend.toolName),
          title: `Approve ${suspend.toolName}`, payload: suspend.args, status: 'pending',
        } as never);
        await this.approvals.decide(resume.approvalId, { status: resume.approved ? 'executed' : 'rejected', decidedByUserId: principal.id, decidedAt: new Date() } as never);
        emit({ type: 'approval-required', approvalId: next.id, toolCallId: suspend.toolCallId, toolName: suspend.toolName, actionType: actionTypeForTool(suspend.toolName), title: `Approve ${suspend.toolName}`, payload: suspend.args });
        emit({ type: 'done', status: 'awaiting_approval' });
        return;
      }

      await this.approvals.decide(resume.approvalId, {
        status: resume.approved ? 'executed' : 'rejected',
        decidedByUserId: principal.id,
        decidedAt: new Date(),
      } as never);
      await this.runs.finish(appr.runId, { status: resume.approved ? 'succeeded' : 'cancelled', finishedAt: new Date() } as never);
      emit({ type: 'done', status: resume.approved ? 'succeeded' : 'cancelled' });
    } catch (err) {
      await this.approvals.decide(resume.approvalId, { status: 'failed', decidedByUserId: principal.id, decidedAt: new Date(), result: { error: err instanceof Error ? err.message : String(err) } } as never);
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      emit({ type: 'done', status: 'failed' });
    }
  }
```

Note: match `ApprovalRepository.decide`'s patch fields to `approval.service.ts` (`status`, `decidedByUserId`, `decidedAt`, `decisionNote`, `result`). `approveToolCall`/`declineToolCall` take `{ runId, toolCallId? }` (confirmed in `@mastra/core` agent `.d.ts` L1392/L1429; same arg shape as the buffered `approveToolCallGenerate` already used in `mastra-adapters.ts`).

- [ ] **Step 4: Run the full service test to verify it passes**

Run: `cd api && npx jest src/features/mastra/services/chat-stream.service.spec.ts`
Expected: PASS (3 tests — new turn ×2 + resume).

- [ ] **Step 5: Build + run the feature suites**

Run: `cd api && pnpm build && npx jest src/features/mastra src/features/document-ingest`
Expected: build succeeds; all mastra + document-ingest specs pass.

- [ ] **Step 6: Commit**

```bash
git add api/src/features/mastra/services/chat-stream.service.ts api/src/features/mastra/services/chat-stream.service.spec.ts
git commit -m "feat(mastra): streaming resume-after-approval path"
```

---

## Manual end-to-end verification (after all tasks)

Run against the dev datastores (Postgres `:30898` / Redis `:30490` from `.env`; Meili on its configured port) with a valid JWT for a non-admin user. Start the API: `cd api && pnpm start:dev`.

1. **Ingestion:** `POST /files` (initiate) → upload bytes to the presigned URL → `POST /files/:id/complete` with a small `.md`, `.pdf`, and `.docx`. After a moment, `POST /search/collections/documents/query` with `{ "q": "", "page": 1 }` returns the three records (`fileId`, `ownerUserId`, `text` populated).
2. **Doc search + streaming:** `curl -N -H "Authorization: Bearer <jwt>" -H 'Content-Type: application/json' -d '{"message":"summarize my uploaded documents"}' http://localhost:3000/agent/chat/stream` — observe `start` → `tool-input`(search-documents) → `tool-output` → `text-delta`… → `done:succeeded`.
3. **HITL over stream:** send a message that triggers `send-email` → stream ends with `approval-required` + `done:awaiting_approval`. Then `curl -N ... -d '{"conversationId":"<id>","resume":{"approvalId":"<id>","approved":true}}' .../agent/chat/stream` → continuation streams and ends `done:succeeded`; the `agent_approval` row is `executed`, `agent_run` is `succeeded`.
4. **History:** `GET /agent/conversations/:id/messages` returns the full ordered thread as `ChatMessageDto[]`. A call with a *different* user's JWT returns 403/404.

---

## Self-review notes

- **Spec coverage:** streaming endpoint (Tasks 7–9) ✓; messages endpoint (Task 6) ✓; extraction→record pipeline (Tasks 1–4) ✓; owner-scoped doc-search tool (Task 5) ✓. All four Part-1 backend gaps from `current_design.md` are covered. Frontend (chat UI, `chat.store`, hooks, attachments UI, data-management upload dialog) is **Part 2**, written against the SSE contract + endpoints above.
- **Deviation from design:** the design assumed a turnkey AI-SDK data stream; the installed `@mastra/core@1.50.1` exposes only `fullStream`/`textStream` and `ai` is not a backend dep, so we emit an explicit SSE protocol (documented above) and Part-2 consumes it with a small custom hook rather than stock `useChat`. Rationale recorded here and in memory ([[ai-assistant-ui-design]]).
- **Scoping simplification:** `search-documents` filters by `ownerUserId` only (the tested `SearchRecordService.search` supports AND-ed equality/`IN`, not `OR`/`NOT EXISTS`). `conversationId` is stored for provenance; conversation-scoped retrieval is a future enhancement.
- **Type consistency:** `INGEST_DOCUMENT_QUEUE`/`INGEST_DOCUMENT_JOB`/`DOCUMENTS_COLLECTION`/`isIngestableDocMime` defined in Task 1, reused verbatim in Tasks 3–5; `SseEvent`/`chunkToSse`/`sseFrame`/`actionTypeForTool` defined in Task 7, reused in Tasks 8–9; `ChatMessageDto`/`toChatMessages` in Task 6.
- **Verify-at-implementation flags (marked inline):** exact `ExceptionService`/`ErrorCode` import paths (Task 2); `FileMetadata` field names (Task 3); Mastra memory-store typing (Task 6); exact `runs.create/finish` + `approvals.create/decide` patch field names (Tasks 8–9). Each has a fallback noted.
