import { Command, CommandRunner } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { KnowledgeAddCommand } from './knowledge-add.command';
import { KnowledgeCategoryAddCommand, KnowledgeCategoryCommand, KnowledgeCategoryEditCommand, KnowledgeCategoryLsCommand, KnowledgeCategoryRmCommand } from './knowledge-category.command';
import { KnowledgeEditCommand } from './knowledge-edit.command';
import { KnowledgeGetCommand } from './knowledge-get.command';
import { KnowledgeLsCommand } from './knowledge-ls.command';
import { KnowledgePublishCommand } from './knowledge-publish.command';
import { KnowledgeRmCommand } from './knowledge-rm.command';
import { KnowledgeTypeAddCommand, KnowledgeTypeCommand, KnowledgeTypeEditCommand, KnowledgeTypeLsCommand, KnowledgeTypeRmCommand } from './knowledge-type.command';

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
    KnowledgeTypeCommand,
    KnowledgeCategoryCommand,
  ],
})
export class KnowledgeCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}

export {
  KnowledgeAddCommand,
  KnowledgeCategoryAddCommand,
  KnowledgeCategoryCommand,
  KnowledgeCategoryEditCommand,
  KnowledgeCategoryLsCommand,
  KnowledgeCategoryRmCommand,
  KnowledgeEditCommand,
  KnowledgeGetCommand,
  KnowledgeLsCommand,
  KnowledgePublishCommand,
  KnowledgeRmCommand,
  KnowledgeTypeAddCommand,
  KnowledgeTypeCommand,
  KnowledgeTypeEditCommand,
  KnowledgeTypeLsCommand,
  KnowledgeTypeRmCommand,
};
