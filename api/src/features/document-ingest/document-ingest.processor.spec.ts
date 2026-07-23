import { DocumentIngestProcessor } from './document-ingest.processor';
import {
  DOCUMENTS_COLLECTION,
  INGEST_DOCUMENT_JOB,
} from './document-ingest.constants';

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
  const extraction = {
    extract: jest.fn().mockResolvedValue({ text: 'body', title: 'Notes' }),
  };
  const records = {
    persist: jest
      .fn()
      .mockResolvedValue([{ id: 'rec-1', externalId: 'file-1' }]),
  };
  const proc = new DocumentIngestProcessor(
    files as never,
    extraction as never,
    records as never,
  );

  it('reads the file, extracts text, and persists a scoped record', async () => {
    await proc.process({
      name: INGEST_DOCUMENT_JOB,
      data: { fileId: 'file-1', ownerId: 'user-1' },
    } as never);
    expect(files.getMetadata).toHaveBeenCalledWith('file-1', {
      id: 'user-1',
      role: 'agent',
    });
    expect(files.getContentStream).toHaveBeenCalledWith('file-1', {
      id: 'user-1',
      role: 'agent',
    });
    expect(extraction.extract).toHaveBeenCalledWith(
      'text/markdown',
      expect.anything(),
    );
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
