import { CommandRunner, SubCommand } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { ContactsChannelAddCommand } from './contacts-channel-add.command';
import { ContactsChannelLsCommand } from './contacts-channel-ls.command';
import { ContactsChannelRmCommand } from './contacts-channel-rm.command';

@SubCommand({
  name: 'channel',
  description: "Manage a contact's channels",
  subCommands: [ContactsChannelLsCommand, ContactsChannelAddCommand, ContactsChannelRmCommand],
})
export class ContactsChannelCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}
