import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LocalAuthGuard } from '../../common/guards/local-auth.guard';
import type { Principal } from '../../common/principal';
import type { UserRow } from '../../infrastructure/database/schema/identity.schema';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ServiceTokenDto } from './dto/service-token.dto';
import { PasswordResetService } from './password-reset.service';
import { ServiceCredentialService } from './service-credential.service';

function reqContext(req: Request) {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: ServiceCredentialService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(200)
  login(@Body() _body: LoginDto, @Req() req: Request & { user: UserRow }) {
    // LocalAuthGuard validated credentials and set req.user = UserRow.
    return this.auth.login(req.user, reqContext(req));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, reqContext(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: LogoutDto) {
    await this.auth.logout(body.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: Principal) {
    await this.auth.logoutAll(user.id as string);
  }

  @Get('me')
  me(@CurrentUser() user: Principal) {
    return this.auth.getProfile(user);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: Principal) {
    return this.auth.listSessions(user.id as string);
  }

  @Patch('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: Principal,
    @Body() body: ChangePasswordDto,
  ) {
    await this.auth.changePassword(
      user.id as string,
      body.currentPassword,
      body.newPassword,
    );
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  @Post('forgot-password')
  @HttpCode(204)
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.passwordReset.request(body.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    await this.passwordReset.reset(body.email, body.code, body.newPassword);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('service-token')
  @HttpCode(200)
  serviceToken(@Body() body: ServiceTokenDto) {
    return this.credentials.exchangeForToken(body.apiKey);
  }
}
