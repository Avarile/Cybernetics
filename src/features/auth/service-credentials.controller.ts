import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createServiceCredentialSchema,
  type CreateServiceCredentialDto,
} from './dto/create-service-credential.dto';
import { ServiceCredentialService } from './service-credential.service';

/** Admin management of agent API keys. */
@Roles('admin')
@Controller('service-credentials')
export class ServiceCredentialsController {
  constructor(private readonly credentials: ServiceCredentialService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(createServiceCredentialSchema))
    dto: CreateServiceCredentialDto,
    @CurrentUser() admin: Principal,
  ) {
    return this.credentials.issue(dto.name, admin.id);
  }

  @Get()
  list() {
    return this.credentials.list();
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.credentials.revoke(id);
  }
}
