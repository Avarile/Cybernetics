import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchRecordService } from './search-record.service';

/**
 * Query + reload surface. `POST .../query` is open to any authenticated
 * principal (global reads); `POST .../reload` is admin-only and runs the full
 * clear-and-rebuild through BullMQ.
 */
@Controller('search/collections/:name')
export class SearchQueryController {
  constructor(private readonly records: SearchRecordService) {}

  @Post('query')
  @HttpCode(200)
  query(@Param('name') name: string, @Body() body: SearchQueryDto) {
    return this.records.search(name, body);
  }

  @Post('reload')
  @Roles('admin')
  @HttpCode(202)
  async reload(@Param('name') name: string): Promise<{ status: string }> {
    await this.records.reload(name);
    return { status: 'accepted' };
  }
}
