import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PersistRecordsDto } from './dto/persist-records.dto';
import { SearchRecordService } from './search-record.service';

/**
 * Record persistence. Admin-only: persist (upsert on externalId) and delete.
 * Writes land in Postgres and are indexed asynchronously (202 Accepted).
 */
@Controller('search/collections/:name/records')
@Roles('admin')
export class RecordController {
  constructor(private readonly records: SearchRecordService) {}

  @Post()
  @HttpCode(202)
  persist(@Param('name') name: string, @Body() dto: PersistRecordsDto) {
    return this.records.persist(name, dto.records);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('name') name: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.records.remove(name, id);
  }
}
