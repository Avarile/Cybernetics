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
import { Roles } from '../../common/decorators/roles.decorator';
import { CollectionService } from './collection.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';

/**
 * Collection management. Mutations are admin-only; reads are open to any
 * authenticated principal so callers can discover what is queryable.
 */
@Controller('search/collections')
export class CollectionController {
  constructor(private readonly collections: CollectionService) {}

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateCollectionDto) {
    return this.collections.create(dto);
  }

  @Get()
  list() {
    return this.collections.list();
  }

  @Get(':name')
  get(@Param('name') name: string) {
    return this.collections.get(name);
  }

  @Patch(':name')
  @Roles('admin')
  update(@Param('name') name: string, @Body() dto: UpdateCollectionDto) {
    return this.collections.update(name, dto);
  }

  @Delete(':name')
  @Roles('admin')
  @HttpCode(204)
  async remove(@Param('name') name: string): Promise<void> {
    await this.collections.remove(name);
  }
}
