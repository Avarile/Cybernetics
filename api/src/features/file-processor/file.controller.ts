import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { QueryFilesDto } from './dto/query-files.dto';
import { FileService } from './file.service';
import type { FilePrincipal } from './file.types';

/**
 * External file API (users). Presigned-only: uploads are initiate → (client
 * uploads directly to MinIO) → complete; downloads are short-lived presigned
 * GET URLs. Ownership is enforced in FileService via the resolved principal.
 *
 * A real auth guard binds here later (`@UseGuards(AuthGuard)`); today the
 * principal comes from the CurrentUser placeholder decorator.
 */
@Controller('files')
export class FileController {
  constructor(private readonly files: FileService) {}

  @Post()
  initiate(
    @Body() body: InitiateUploadDto,
    @CurrentUser() user: FilePrincipal,
  ) {
    return this.files.initiateUpload(body, user);
  }

  @Post(':id/complete')
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CompleteUploadDto,
    @CurrentUser() user: FilePrincipal,
  ) {
    return this.files.completeUpload(id, user, body);
  }

  @Get(':id/download-url')
  downloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('ttl') ttl: string | undefined,
    @CurrentUser() user: FilePrincipal,
  ) {
    const parsed = ttl ? Number(ttl) : undefined;
    const valid = parsed && Number.isFinite(parsed) && parsed > 0;
    return this.files.getDownloadUrl(id, user, {
      ttl: valid ? parsed : undefined,
    });
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: FilePrincipal,
  ) {
    return this.files.getMetadata(id, user);
  }

  @Get()
  list(@Query() query: QueryFilesDto, @CurrentUser() user: FilePrincipal) {
    return this.files.list(query, user);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: FilePrincipal,
  ): Promise<void> {
    await this.files.softDelete(id, user);
  }
}
