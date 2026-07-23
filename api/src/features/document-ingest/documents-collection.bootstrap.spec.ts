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
