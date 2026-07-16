import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { EmailModule } from '../../infrastructure/email/email.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetRepository } from './password-reset.repository';
import { PasswordResetService } from './password-reset.service';
import { ResetCodeHasher } from './reset-code-hasher';
import { ResetMailer } from './reset-mailer';
import { ServiceCredentialRepository } from './service-credential.repository';
import { ServiceCredentialService } from './service-credential.service';
import { ServiceCredentialsController } from './service-credentials.controller';
import { SessionRepository } from './session.repository';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { TokenService } from './token.service';

/**
 * Auth feature. Depends on UsersModule (UserRepository + PasswordService) and
 * wires the Passport strategies. Access tokens are signed per-call with the
 * secret from auth config, so JwtModule needs no static secret here.
 * EmailModule is imported for ResetMailer's MailerService dependency.
 */
@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({}), EmailModule],
  controllers: [AuthController, ServiceCredentialsController],
  providers: [
    AuthService,
    TokenService,
    SessionRepository,
    ServiceCredentialRepository,
    ServiceCredentialService,
    LocalStrategy,
    JwtStrategy,
    PasswordResetService,
    PasswordResetRepository,
    ResetCodeHasher,
    ResetMailer,
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
