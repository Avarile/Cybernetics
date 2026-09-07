import { Command, CommandRunner } from 'nest-commander';
import { TagsAddCommand } from './tags-add.command';
import { TagsEditCommand } from './tags-edit.command';
import { TagsLsCommand } from './tags-ls.command';
import { TagsRmCommand } from './tags-rm.command';

@Command({
  name: 'tags',
  description: 'Manage the shared tag vocabulary',
  subCommands: [TagsLsCommand, TagsAddCommand, TagsEditCommand, TagsRmCommand],
})
export class TagsCommand extends CommandRunner {
  async run(): Promise<void> {
    this.command.help();
  }
}

export { TagsAddCommand, TagsEditCommand, TagsLsCommand, TagsRmCommand };
