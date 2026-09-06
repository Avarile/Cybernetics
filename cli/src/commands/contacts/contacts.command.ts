import { Command, CommandRunner } from 'nest-commander';
import { ContactsAddCommand } from './contacts-add.command';
import { ContactsChannelAddCommand } from './contacts-channel-add.command';
import { ContactsChannelLsCommand } from './contacts-channel-ls.command';
import { ContactsChannelRmCommand } from './contacts-channel-rm.command';
import { ContactsChannelCommand } from './contacts-channel.command';
import { ContactsEditCommand } from './contacts-edit.command';
import { ContactsGetCommand } from './contacts-get.command';
import { ContactsInteractionsCommand } from './contacts-interactions.command';
import { ContactsLogCommand } from './contacts-log.command';
import { ContactsLsCommand } from './contacts-ls.command';
import { ContactsRmCommand } from './contacts-rm.command';

@Command({
  name: 'contacts',
  description: 'Manage contacts',
  subCommands: [
    ContactsLsCommand,
    ContactsGetCommand,
    ContactsAddCommand,
    ContactsEditCommand,
    ContactsRmCommand,
    ContactsChannelCommand,
    ContactsLogCommand,
    ContactsInteractionsCommand,
  ],
})
export class ContactsCommand extends CommandRunner {
  async run(): Promise<void> {
    this.command.help();
  }
}

export {
  ContactsAddCommand,
  ContactsChannelAddCommand,
  ContactsChannelCommand,
  ContactsChannelLsCommand,
  ContactsChannelRmCommand,
  ContactsEditCommand,
  ContactsGetCommand,
  ContactsInteractionsCommand,
  ContactsLogCommand,
  ContactsLsCommand,
  ContactsRmCommand,
};
