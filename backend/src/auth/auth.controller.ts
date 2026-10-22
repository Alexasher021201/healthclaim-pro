import {
  Controller,
  Post,
  Body,
  UsePipes,
  Req,
  UseGuards,
  Get,
  Query,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import {
  LoginRequest,
  LoginRequestSchema,
  RegisterRequest,
  RegisterRequestSchema,
  VerifyEmailRequest,
  VerifyEmailRequestSchema,
} from '@healthclaim/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';
import { ClientIp, extractClientIp } from '../common/decorators/client-ip.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) loginDto: LoginRequest,
    @Req() req: Request,
    @ClientIp() clientIp?: string,
  ) {
    const ip = clientIp || extractClientIp(req);
    const userAgent = req?.headers?.['user-agent'];
    return this.authService.login(loginDto, ip, userAgent);
  }

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(RegisterRequestSchema)) registerDto: RegisterRequest,
    @Req() req: Request,
    @ClientIp() clientIp?: string,
  ) {
    const ip = clientIp || extractClientIp(req);
    const userAgent = req?.headers?.['user-agent'];
    return this.authService.register(registerDto, ip, userAgent);
  }

  /**
   * TODO: Reserved for future Email Verification module
   */
  @Post('send-verification-email')
  @UseGuards(JwtAuthGuard)
  async sendVerificationEmail(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.sendVerificationEmail(user.id);
  }

  @Post('resend-verification')
  async resendVerification(@Body('email') email: string) {
    return this.authService.resendVerificationByEmail(email || '');
  }

  /**
   * TODO: Reserved for future Email Verification module
   */
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }
}
