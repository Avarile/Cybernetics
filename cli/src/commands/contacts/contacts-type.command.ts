import { Optional } from '@nestjs/common';
import { confirm as promptConfirm } from '@inquirer/prompts';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { ClientFactory } from '../../core/http/client.factory';
import {
  runVocabularyAdd,
  runVocabularyEdit,
  runVocabularyLs,
  runVocabularyRm,
  type ConfirmPrompt,
  type VocabAddOptions,
  type VocabCommonOptions,
  type VocabLsOptions,
  type VocabRmOptions,
} from '../vocabulary/vocabulary-crud';
import { CONTACT_TYPE_VOCAB_CONFIG } from './contacts.helpers';

@SubCommand({ name: 'ls', description: 'List contact types' })
export class ContactsTypeLsCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
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

  @Option({ flags: '--json', description: 'Emit the raw contact type list' })
  parseJson(): boolean {
    return true;
  }

  async run(_params: string[], options: VocabLsOptions): Promise<void> {
    await runVocabularyLs(CONTACT_TYPE_VOCAB_CONFIG, this.settings, this.clients, options);
  }
}

@SubCommand({ name: 'add', description: 'Create a contact type' })
export class ContactsTypeAddCommand extends CommandRunner {
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

  // Declaration order matters: --edit must be registered before --no-edit so
  // commander's addOption() sees the positive counterpart already exists and
  // skips forcing the negate-implied default of `true` (see VocabAddOptions.edit).
  @Option({ flags: '--edit', description: 'Force opening the editor even when field flags are given' })
  parseEdit(): boolean {
    return true;
  }

  // commander calls this for the negate flag regardless of nest-commander's
  // usual "just return true" idiom — it uses the handler's return value as
  // the option's value verbatim, so a negate option's handler must actually
  // return `false`, or `--no-edit` would set `edit` to `true` like every
  // other boolean flag in this codebase.
  @Option({ flags: '--no-edit', description: 'Never open the editor; use field flags only' })
  parseNoEdit(): boolean {
    return false;
  }

  @Option({ flags: '--key <key>', description: 'Lowercase slug key (optional; derived from --name)' })
  parseKey(v: string): string {
    return v;
  }

  @Option({ flags: '--name <text>', description: 'Display name' })
  parseName(v: string): string {
    return v;
  }

  @Option({ flags: '--description <text>', description: 'Description' })
  parseDescription(v: string): string {
    return v;
  }

  @Option({ flags: '--sort-order <n>', description: 'Sort order (default 0)' })
  parseSortOrder(v: string): number {
    return Number(v);
  }

  async run(_params: string[], options: VocabAddOptions): Promise<void> {
    await runVocabularyAdd(CONTACT_TYPE_VOCAB_CONFIG, this.settings, this.clients, this.editor, options);
  }
}

@SubCommand({ name: 'edit', arguments: '<id>', description: 'Edit a contact type' })
export class ContactsTypeEditCommand extends CommandRunner {
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

  async run(params: string[], options: VocabCommonOptions): Promise<void> {
    const [id] = params;
    await runVocabularyEdit(CONTACT_TYPE_VOCAB_CONFIG, this.settings, this.clients, this.editor, id, options);
  }
}

@SubCommand({ name: 'rm', arguments: '<id>', description: 'Delete a contact type' })
export class ContactsTypeRmCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
    @Optional()
    private readonly confirmPrompt: ConfirmPrompt = (message) =>
      promptConfirm({ message, default: false }),
    @Optional() private readonly isTTY: () => boolean = () => Boolean(process.stdin.isTTY),
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

  @Option({ flags: '--yes', description: 'Skip the confirmation prompt' })
  parseYes(): boolean {
    return true;
  }

  async run(params: string[], options: VocabRmOptions): Promise<void> {
    const [id] = params;
    await runVocabularyRm(
      CONTACT_TYPE_VOCAB_CONFIG,
      this.settings,
      this.clients,
      this.confirmPrompt,
      this.isTTY,
      id,
      options,
    );
  }
}

@SubCommand({
  name: 'type',
  description: 'Manage contact types',
  subCommands: [ContactsTypeLsCommand, ContactsTypeAddCommand, ContactsTypeEditCommand, ContactsTypeRmCommand],
})
export class ContactsTypeCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}
