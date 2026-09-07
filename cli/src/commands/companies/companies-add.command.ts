import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { COMPANIES_CREATE_SCHEMA, type CompanyRecord } from './companies.helpers';

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
  name?: string;
  legalName?: string;
  domain?: string;
  industry?: string;
  size?: string;
  website?: string;
  phone?: string;
  country?: string;
  parentCompanyId?: string;
  status?: string;
  description?: string;
  taxNumber?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'name',
  'legalName',
  'domain',
  'industry',
  'size',
  'website',
  'phone',
  'country',
  'parentCompanyId',
  'status',
  'description',
  'taxNumber',
];

@SubCommand({ name: 'add', description: 'Create a company' })
export class CompaniesAddCommand extends CommandRunner {
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

  @Option({ flags: '--name <text>', description: 'Company name' })
  parseName(v: string): string {
    return v;
  }

  @Option({ flags: '--legal-name <text>', description: 'Legal name' })
  parseLegalName(v: string): string {
    return v;
  }

  @Option({ flags: '--domain <domain>', description: 'Email domain (natural key for domain matching)' })
  parseDomain(v: string): string {
    return v;
  }

  @Option({ flags: '--industry <text>', description: 'Industry' })
  parseIndustry(v: string): string {
    return v;
  }

  @Option({ flags: '--size <size>', description: 'micro|small|medium|large|enterprise' })
  parseSize(v: string): string {
    return v;
  }

  @Option({ flags: '--website <url>', description: 'Website URL' })
  parseWebsite(v: string): string {
    return v;
  }

  @Option({ flags: '--phone <text>', description: 'Phone number' })
  parsePhone(v: string): string {
    return v;
  }

  @Option({ flags: '--country <code>', description: 'Two-letter country code' })
  parseCountry(v: string): string {
    return v;
  }

  @Option({ flags: '--parent-company-id <uuid>', description: 'Parent company id' })
  parseParentCompanyId(v: string): string {
    return v;
  }

  @Option({ flags: '--status <status>', description: 'active|inactive|archived|do_not_contact (default active)' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--description <text>', description: 'Description' })
  parseDescription(v: string): string {
    return v;
  }

  @Option({ flags: '--tax-number <text>', description: 'Tax number' })
  parseTaxNumber(v: string): string {
    return v;
  }

  async run(_params: string[], options: AddOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --name (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<CompanyRecord>('/companies', dto);
      process.stdout.write(`Created "${created.name}" (${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({ schema: COMPANIES_CREATE_SCHEMA });
      await this.editor.run({
        initial,
        filetype: 'md',
        submit: async (doc) => {
          await create({ ...doc.fields });
        },
      });
      return;
    }

    if (options.name === undefined) throw new UsageError('--name is required.');

    const dto: Record<string, unknown> = { name: options.name };
    if (options.legalName !== undefined) dto.legalName = options.legalName;
    if (options.domain !== undefined) dto.domain = options.domain;
    if (options.industry !== undefined) dto.industry = options.industry;
    if (options.size !== undefined) dto.size = options.size;
    if (options.website !== undefined) dto.website = options.website;
    if (options.phone !== undefined) dto.phone = options.phone;
    if (options.country !== undefined) dto.country = options.country;
    if (options.parentCompanyId !== undefined) dto.parentCompanyId = options.parentCompanyId;
    if (options.status !== undefined) dto.status = options.status;
    if (options.description !== undefined) dto.description = options.description;
    if (options.taxNumber !== undefined) dto.taxNumber = options.taxNumber;

    await create(dto);
  }
}
