import { Injectable, UnauthorizedException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { LoginRequest, RegisterRequest, AuthResponse, UserRole, UserStatus } from '@healthclaim/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Optional() private readonly mailService?: MailService,
  ) {}

  /**
   * User login with email and password
   */
  async login(loginDto: LoginRequest, ipAddress?: string, userAgent?: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email.toLowerCase().trim() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(`Account is ${user.status.toLowerCase()}`);
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    // Record login audit log
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'USER_LOGIN',
        targetResource: 'AUTH',
        targetResourceId: user.id,
        ipAddress,
        userAgent,
      },
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role as UserRole,
        department: user.department,
        isEmailVerified: user.isEmailVerified,
      },
    };
  }

  /**
   * Register new user and auto-assign default employee policy if applicable
   */
  async register(registerDto: RegisterRequest, ipAddress?: string, userAgent?: string): Promise<AuthResponse> {
    const email = registerDto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      throw new ConflictException('An account with this email address already exists');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        department: registerDto.department,
        role: registerDto.role,
        status: UserStatus.ACTIVE,
        isEmailVerified: false,
      },
    });

    // If registered user is an EMPLOYEE, auto-assign default Standard Benefit Tier quota
    if (user.role === UserRole.EMPLOYEE) {
      const defaultTier = await this.prisma.benefitTier.findFirst({
        where: { code: 'TIER_STANDARD' },
      });

      if (defaultTier) {
        const currentYear = new Date().getFullYear();
        await this.prisma.userPolicyQuota.create({
          data: {
            userId: user.id,
            benefitTierId: defaultTier.id,
            fiscalYear: currentYear,
            annualLimit: defaultTier.annualLimit,
            remainingBalance: defaultTier.annualLimit,
            cumulativeDeductibleSpent: 0,
          },
        });
      }
    }

    // Record registration audit log
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'USER_REGISTER',
        targetResource: 'AUTH',
        targetResourceId: user.id,
        ipAddress,
        userAgent,
      },
    });

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role as UserRole,
        department: user.department,
        isEmailVerified: user.isEmailVerified,
      },
    };
  }

  /**
   * TODO: Reserved for future Email Verification module
   * Sends an email verification link with a secure token to the user
   */
  async sendVerificationEmail(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.isEmailVerified) {
      return { message: 'Email is already verified' };
    }

    // Generate token placeholder
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.prisma.verificationToken.create({
      data: {
        email: user.email,
        token,
        expiresAt,
      },
    });

    // Dispatch email verification link via Resend
    if (this.mailService) {
      await this.mailService.sendVerificationEmail(user.email, token, user.firstName);
    } else {
      console.log(`[EMAIL_VERIFICATION_SIMULATION] Verification link for ${user.email}: https://healthclaim.pro/verify-email?token=${token}`);
    }

    return { message: 'Verification email sent successfully' };
  }

  /**
   * TODO: Reserved for future Email Verification module
   * Verifies the email token and marks user as verified
   */
  async verifyEmail(token: string): Promise<{ message: string }> {
    const record = await this.prisma.verificationToken.findUnique({ where: { token } });
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: { email: record.email },
      data: { isEmailVerified: true },
    });

    await this.prisma.verificationToken.delete({ where: { token } });

    return { message: 'Email has been verified successfully' };
  }
}
