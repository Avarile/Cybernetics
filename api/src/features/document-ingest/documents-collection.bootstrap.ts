import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { CollectionService } from '../search-service/collection.service';
import {
  DOCUMENTS_COLLECTION,
  documentsCollectionFields,
} from './document-ingest.constants';

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
        description:
          'Extracted text from uploaded documents, searchable by the agent.',
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
