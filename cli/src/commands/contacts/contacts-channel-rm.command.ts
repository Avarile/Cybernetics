import { Optional } from '@nestjs/common';
import { confirm as promptConfirm } from '@inquirer/prompts';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, contactByEmailOrName } from '../../core/resolve/resolver';
import type { ContactChannelRecord } from './contacts.helpers';

export type ConfirmPrompt = (message: string) => Promise<boolean>;

interface ChannelRmOptions {
  profile?: string;
  api?: string;
  yes?: boolean;
}

@SubCommand({ name: 'rm', arguments: '<addr> <channelId>', description: 'Remove a contact channel' })
export class ContactsChannelRmCommand extends CommandRunner {
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

  async run(params: string[], options: ChannelRmOptions): Promise<void> {
    const [addr, channelId] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const id = await new AddressResolver(client).resolve(addr, contactByEmailOrName);

    // `/contacts/{id}/channels` has no by-id lookup, only the full list (see
    // ContactController_channels in operations.ts) — fetched here so the
    // channel actually belongs to this contact and so its kind/value can
    // name it in the confirmation, rather than confirming a bare id.
    const channels = await client.get<ContactChannelRecord[]>(`/contacts/${id}/channels`);
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      throw new UsageError(`No channel matches "${channelId}" on this contact.`);
    }

    if (!options.yes) {
      if (!this.isTTY()) {
        throw new UsageError(
          `Refusing to remove the ${channel.kind} channel "${channel.value}" without --yes in a non-interactive session.`,
        );
      }
      const confirmed = await this.confirmPrompt(
        `Remove the ${channel.kind} channel "${channel.value}"?`,
      );
      if (!confirmed) {
        process.stdout.write('Aborted.\n');
        return;
      }
    }

    await client.del(`/contacts/${id}/channels/${channelId}`);
    process.stdout.write(`Removed the ${channel.kind} channel "${channel.value}".\n`);
  }
}
