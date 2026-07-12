import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Principal } from '../../common/principal';
import { searchQuerySchema, type SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

/**
 * External search API (users). `POST /search/:index` with a JSON query body.
 * The index is validated against the registry (404 if unknown) and results are
 * owner-scoped in SearchService via the resolved principal.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Post(':index')
  run(
    @Param('index') index: string,
    @Body(new ZodValidationPipe(searchQuerySchema)) body: SearchQueryDto,
    @CurrentUser() user: Principal,
  ) {
    return this.search.search(index, body, user);
  }
}
