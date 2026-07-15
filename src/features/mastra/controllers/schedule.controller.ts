import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  createScheduleSchema,
  type CreateScheduleDto,
} from '../dto/schedule.dto';
import { ScheduleService } from '../services/schedule.service';

@Controller('agent/schedules')
@Roles('admin')
export class ScheduleController {
  constructor(private readonly schedules: ScheduleService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(createScheduleSchema)) dto: CreateScheduleDto,
  ) {
    return this.schedules.create(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.schedules.remove(id);
  }
}
