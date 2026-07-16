import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { MeiliSearch } from 'meilisearch';
import { MEILI_CLIENT } from '../search-engine/meili.constants';

/**
 * Terminus health indicator that pings MeiliSearch. Mirrors the MinIO indicator.
 */
@Injectable()
export class MeiliHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(MEILI_CLIENT) private readonly client: MeiliSearch,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const healthy = await this.client.isHealthy();
      return healthy
        ? indicator.up()
        : indicator.down({ message: 'meilisearch not healthy' });
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}
