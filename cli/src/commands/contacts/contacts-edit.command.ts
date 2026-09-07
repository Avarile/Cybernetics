import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, contactByEmailOrName } from '../../core/resolve/resolver';
import { VocabularyIndex } from '../../core/resolve/vocabulary';
import { buildContactDocument, buildContactPatch, resolveContactKeyBacked, type ContactRecord } from './contacts.helpers';

interface EditOptions {
  profile?: string;
  api?: string;
}

@SubCommand({ name: 'edit', arguments: '<addr>', description: 'Edit a contact' })
export class ContactsEditCommand extends CommandRunner {
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

    const id = await new AddressResolver(client).resolve(addr, contactByEmailOrName);
    const record = await client.get<ContactRecord>(`/contacts/${id}`);
    // One VocabularyIndex per invocation (design spec §3), shared across
    // every key-backed field for both rendering the buffer and resolving
    // the submitted patch, so e.g. a company (never cached) is fetched once.
    const vocab = new VocabularyIndex(client);
    const keyBackedCurrent = await resolveContactKeyBacked(record, vocab);

    await this.editor.run({
      initial: buildContactDocument(record, keyBackedCurrent),
      filetype: 'md',
      submit: async (doc) => {
        const patch = await buildContactPatch(record, doc, keyBackedCurrent, vocab);

        if (Object.keys(patch).length === 0) {
          process.stdout.write('No changes to save.\n');
          return;
        }

        // Unlike knowledge, UpdateContactDto has no `expectedVersion` field —
        // contacts carries no optimistic-concurrency version to send, so a
        // rejection here (404, 403, or a 400 with issues) propagates through
        // EditorService's generic retry/throw logic unmodified.
        const updated = await client.patch<ContactRecord>(`/contacts/${id}`, patch);
        process.stdout.write(`Updated "${updated.displayName}".\n`);
      },
    });
  }
}
