import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { TAGS_CREATE_SCHEMA, type TagRecord } from './tags.helpers';

interface AddOptions {
  profile?: string;
  api?: string;
  /**
   * Three states via commander's dual-option support (`--edit` registered
   * before `--no-edit` in this class so its presence suppresses the
   * negate-implied default — see command-runner.service.js's addOption):
   * `undefined` (neither flag), `true` (--edit), `false` (--no-edit).
   */
  edit?: boolean;
  key?: string;
  label?: string;
  scope?: string;
  color?: string;
  description?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = ['key', 'label', 'scope', 'color', 'description'];

@SubCommand({ name: 'add', description: 'Create a tag' })
export class TagsAddCommand extends CommandRunner {
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
  // skips forcing the negate-implied default of `true` (see AddOptions.edit).
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

  @Option({ flags: '--key <key>', description: 'Lowercase slug key' })
  parseKey(v: string): string {
    return v;
  }

  @Option({ flags: '--label <text>', description: 'Display label' })
  parseLabel(v: string): string {
    return v;
  }

  @Option({ flags: '--scope <scope>', description: 'knowledge|contact|project|task|shared (default shared)' })
  parseScope(v: string): string {
    return v;
  }

  @Option({ flags: '--color <color>', description: 'Color' })
  parseColor(v: string): string {
    return v;
  }

  @Option({ flags: '--description <text>', description: 'Description' })
  parseDescription(v: string): string {
    return v;
  }

  async run(_params: string[], options: AddOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --key and --label (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<TagRecord>('/tags', dto);
      process.stdout.write(`Created tag "${created.key}" (${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({ schema: TAGS_CREATE_SCHEMA });
      await this.editor.run({
        initial,
        filetype: 'md',
        submit: async (doc) => {
          await create({ ...doc.fields });
        },
      });
      return;
    }

    if (options.key === undefined) throw new UsageError('--key is required.');
    if (options.label === undefined) throw new UsageError('--label is required.');

    const dto: Record<string, unknown> = { key: options.key, label: options.label };
    if (options.scope !== undefined) dto.scope = options.scope;
    if (options.color !== undefined) dto.color = options.color;
    if (options.description !== undefined) dto.description = options.description;

    await create(dto);
  }
}
