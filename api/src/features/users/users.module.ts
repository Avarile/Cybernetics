import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { TokenRevocationModule } from '../auth/token-revocation.module';
import { UserRepository } from './user.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Users feature. Owns admin user provisioning and exports the repository,
 * service, and PasswordService so AuthModule can reuse them (Auth → Users;
 * Users has no dependency on Auth, so no circular import).
 */
@Module({
  imports: [TokenRevocationModule],
  controllers: [UsersController],
  providers: [UserRepository, UsersService, PasswordService],
  exports: [UserRepository, UsersService, PasswordService],
})
export class UsersModule {}
