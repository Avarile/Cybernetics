import { Command, CommandRunner } from 'nest-commander';
import { KnowledgeAddCommand } from './knowledge-add.command';
import { KnowledgeEditCommand } from './knowledge-edit.command';
import { KnowledgeGetCommand } from './knowledge-get.command';
import { KnowledgeLsCommand } from './knowledge-ls.command';
import { KnowledgePublishCommand } from './knowledge-publish.command';
import { KnowledgeRmCommand } from './knowledge-rm.command';

@Command({
  name: 'knowledge',
  description: 'Manage knowledge records',
  subCommands: [
    KnowledgeLsCommand,
    KnowledgeGetCommand,
    KnowledgeAddCommand,
    KnowledgeEditCommand,
    KnowledgePublishCommand,
    KnowledgeRmCommand,
  ],
})
export class KnowledgeCommand extends CommandRunner {
  async run(): Promise<void> {
    this.command.help();
  }
}

export {
  KnowledgeAddCommand,
  KnowledgeEditCommand,
  KnowledgeGetCommand,
  KnowledgeLsCommand,
  KnowledgePublishCommand,
  KnowledgeRmCommand,
};
