import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { ApiError, ExitCode } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, knowledgeBySlug } from '../../core/resolve/resolver';
import { VocabularyIndex } from '../../core/resolve/vocabulary';
import {
  buildKnowledgeDocument,
  buildKnowledgePatch,
  resolveKnowledgeKeyBacked,
  type KnowledgeRecord,
} from './knowledge.helpers';

interface EditOptions {
  profile?: string;
  api?: string;
}

@SubCommand({ name: 'edit', arguments: '<addr>', description: 'Edit a knowledge record' })
export class KnowledgeEditCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
    @Optional() private readonly editor: EditorService = new EditorService(),
  ) {
    super();
  }

  @Option({ flags: '-p, --profile <name>', description: 'Profile to use' })
  parseProfile(v: string): string {
    return v;
  }

  @Option({ flags: '--api <url>', description: 'Override the API base URL' })
  parseApi(v: string): string {
    return v;
  }

  async run(params: string[], options: EditOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const id = await new AddressResolver(client).resolve(addr, knowledgeBySlug);
    const record = await client.get<KnowledgeRecord>(`/knowledge/${id}`);
    // One VocabularyIndex per invocation (design spec §3), shared across
    // every key-backed field for both rendering the buffer and resolving
    // the submitted patch.
    const vocab = new VocabularyIndex(client);
    const keyBackedCurrent = await resolveKnowledgeKeyBacked(record, vocab);

    await this.editor.run({
      initial: buildKnowledgeDocument(record, keyBackedCurrent),
      filetype: 'md',
      submit: async (doc) => {
        const patch = await buildKnowledgePatch(record, doc, keyBackedCurrent, vocab);

        if (Object.keys(patch).length === 0) {
          process.stdout.write('No changes to save.\n');
          return;
        }

        // Optimistic concurrency: the server 409s if the record moved since
        // `record` was fetched, rather than silently taking this write.
        patch.expectedVersion = record.version;

        try {
          const updated = await client.patch<KnowledgeRecord>(`/knowledge/${id}`, patch);
          process.stdout.write(`Updated "${updated.slug}".\n`);
        } catch (err) {
          if (err instanceof ApiError && err.exitCode === ExitCode.Conflict) {
            throw new ApiError(
              err.status,
              err.code,
              'This record changed on the server since you fetched it — re-run the edit to try again.',
              err.issues,
              err.correlationId,
            );
          }
          throw err;
        }
      },
    });
  }
}
