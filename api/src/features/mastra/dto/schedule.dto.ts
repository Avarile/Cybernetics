import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AGENT_ID } from '../mastra.constants';

export const createScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  cron: z.string().min(1).max(120),
  timezone: z.string().max(64).default('UTC'),
  agentId: z.string().default(AGENT_ID),
  promptTemplate: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  deliveryChannel: z
    .enum(['conversation', 'email', 'none'])
    .default('conversation'),
  deliveryTarget: z.string().max(500).optional(),
  targetUserId: z.string().uuid().optional(),
  enabled: z.boolean().default(true),
});

export class CreateScheduleDto extends createZodDto(createScheduleSchema) {}
