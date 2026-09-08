import { Command, CommandRunner } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { ContactsAddCommand } from './contacts-add.command';
import { ContactsCategoryAddCommand, ContactsCategoryCommand, ContactsCategoryEditCommand, ContactsCategoryLsCommand, ContactsCategoryRmCommand } from './contacts-category.command';
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
import { ContactsTypeAddCommand, ContactsTypeCommand, ContactsTypeEditCommand, ContactsTypeLsCommand, ContactsTypeRmCommand } from './contacts-type.command';

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
    ContactsTypeCommand,
    ContactsCategoryCommand,
  ],
})
export class ContactsCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}

export {
  ContactsAddCommand,
  ContactsCategoryAddCommand,
  ContactsCategoryCommand,
  ContactsCategoryEditCommand,
  ContactsCategoryLsCommand,
  ContactsCategoryRmCommand,
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
  ContactsTypeAddCommand,
  ContactsTypeCommand,
  ContactsTypeEditCommand,
  ContactsTypeLsCommand,
  ContactsTypeRmCommand,
};
