import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { SearchServiceModule } from '../search-service/search-service.module';
import { EntityAccessRegistry } from '../shared/entity-access.registry';
import { SharedModule } from '../shared/shared.module';
import { PlanningRepository } from './planning.repository';
import { PlanningService } from './planning.service';
import { ProjectCollectionBootstrap } from './project-collection.bootstrap';
import { ProjectLinkRepository } from './project-link.repository';
import { ProjectLinkService } from './project-link.service';
import { ProjectProjectionService } from './project-projection.service';
import { ProjectController } from './project.controller';
import { ProjectRepository } from './project.repository';
import { ProjectService } from './project.service';
import { TaskController } from './task.controller';
import { TaskRepository } from './task.repository';
import { TaskService } from './task.service';

/**
 * Project management: projects, membership, tasks, planning artefacts,
 * references to knowledge and contacts, and logged time.
 *
 * Depends on `ContactsModule` so a contact link can be authorized against the
 * contact's own scope — linking must not be a way to discover contacts.
 */
@Module({
  imports: [SharedModule, SearchServiceModule, ContactsModule],
  controllers: [ProjectController, TaskController],
  providers: [
    ProjectRepository,
    TaskRepository,
    PlanningRepository,
    ProjectLinkRepository,
    ProjectProjectionService,
    ProjectService,
    TaskService,
    PlanningService,
    ProjectLinkService,
    ProjectCollectionBootstrap,
  ],
  exports: [
    ProjectService,
    TaskService,
    ProjectLinkService,
    // Exported for FinanceModule, which stamps billed entries when it turns
    // logged time into an invoice line.
    ProjectLinkRepository,
  ],
})
export class ProjectsModule implements OnApplicationBootstrap {
  constructor(
    private readonly access: EntityAccessRegistry,
    private readonly projects: ProjectService,
    private readonly tasks: TaskService,
  ) {}

  onApplicationBootstrap(): void {
    // Comments and attachments on projects and tasks stay admin-only until
    // these resolvers are registered.
    this.access.register('project', (id, principal) =>
      this.projects.canRead(id, principal),
    );
    this.access.register('task', (id, principal) =>
      this.tasks.canRead(id, principal),
    );
    // Milestones and goals hang off a project and have no separate ACL; the
    // registry needs an entry for each so their comments resolve.
    this.access.register('milestone', () => Promise.resolve(false));
    this.access.register('goal', () => Promise.resolve(false));
  }
}
