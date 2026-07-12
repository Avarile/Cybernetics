import { Module } from '@nestjs/common';
import { MastraModule as MastraCoreModule } from '@mastra/nestjs';
import { mastra } from './index';

/**
 * Mastra AI feature module (scaffold).
 *
 * Registers the Mastra instance with the `@mastra/nestjs` adapter, which
 * exposes registered agents under `/api/agents/{agentId}` and provides
 * `MastraService` / the `MASTRA` token for injection.
 *
 * NOTE: this module MUST be imported last in `AppModule` — the adapter mounts a
 * catch-all controller that would otherwise intercept unrelated routes.
 */
@Module({
  imports: [MastraCoreModule.register({ mastra })],
})
export class MastraModule {}
