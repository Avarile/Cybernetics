import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CollectionService } from './collection.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';

/**
 * Collection management. Mutations are admin-only; reads are open to any
 * authenticated principal so callers can discover what is queryable.
 */
@ApiTags('Search')
@Controller('search/collections')
export class CollectionController {
  constructor(private readonly collections: CollectionService) {}

  @ApiOperation({ summary: 'Create a collection' })
  @Post()
  @Roles('admin')
  create(@Body() dto: CreateCollectionDto) {
    return this.collections.create(dto);
  }

  @ApiOperation({ summary: 'List all collections' })
  @Get()
  list() {
    return this.collections.list();
  }

  @ApiOperation({ summary: 'Get a collection by name' })
  @Get(':name')
  get(@Param('name') name: string) {
    return this.collections.get(name);
  }

  @ApiOperation({ summary: 'Update a collection' })
  @Patch(':name')
  @Roles('admin')
  update(@Param('name') name: string, @Body() dto: UpdateCollectionDto) {
    return this.collections.update(name, dto);
  }

  @ApiOperation({ summary: 'Delete a collection' })
  @Delete(':name')
  @Roles('admin')
  @HttpCode(204)
  async remove(@Param('name') name: string): Promise<void> {
    await this.collections.remove(name);
  }
}
