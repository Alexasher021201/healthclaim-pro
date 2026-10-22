import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { UserRole, UserStatus } from '@healthclaim/shared';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

describe('AuthService (TDD)', () => {
  let authService: AuthService;
  let mockPrismaService: any;
  let mockJwtService: any;

  beforeEach(() => {
    mockPrismaService = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      benefitTier: {
        findFirst: vi.fn(),
      },
      userPolicyQuota: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      verificationToken: {
        create: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
    };

    mockJwtService = {
      sign: vi.fn().mockReturnValue('mocked-jwt-token-xyz'),
    };

    authService = new AuthService(mockPrismaService, mockJwtService);
  });

  describe('login', () => {
    it('should successfully authenticate active user with valid credentials', async () => {
      const plainPassword = 'Password123!';
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        email: 'employee@healthclaim.pro',
        passwordHash: hashedPassword,
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.EMPLOYEE,
        status: UserStatus.ACTIVE,
        department: 'Engineering',
        isEmailVerified: true,
      });

      const result = await authService.login({
        email: 'employee@healthclaim.pro',
        password: plainPassword,
      });

      expect(result).toBeDefined();
      expect(result.accessToken).toBe('mocked-jwt-token-xyz');
      expect(result.user.email).toBe('employee@healthclaim.pro');
      expect(result.user.role).toBe(UserRole.EMPLOYEE);
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'USER_LOGIN',
            targetResourceId: 'usr-1',
          }),
        }),
      );
    });

    it('should reject non-existent user with UnauthorizedException', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'unknown@healthclaim.pro',
          password: 'Password123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject wrong password with UnauthorizedException', async () => {
      const hashedPassword = await bcrypt.hash('CorrectPass123!', 10);

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        email: 'test@healthclaim.pro',
        passwordHash: hashedPassword,
        status: UserStatus.ACTIVE,
      });

      await expect(
        authService.login({
          email: 'test@healthclaim.pro',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject inactive or suspended user accounts', async () => {
      const plainPassword = 'Password123!';
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'usr-2',
        email: 'suspended@healthclaim.pro',
        passwordHash: hashedPassword,
        status: UserStatus.SUSPENDED,
      });

      await expect(
        authService.login({
          email: 'suspended@healthclaim.pro',
          password: plainPassword,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject unverified user account with UnauthorizedException', async () => {
      const plainPassword = 'Password123!';
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'usr-unverified',
        email: 'unverified@healthclaim.pro',
        passwordHash: hashedPassword,
        status: UserStatus.ACTIVE,
        isEmailVerified: false,
      });

      await expect(
        authService.login({
          email: 'unverified@healthclaim.pro',
          password: plainPassword,
        }),
      ).rejects.toThrow('Please verify your email address before logging in');
    });
  });

  describe('register', () => {
    it('should successfully register a new employee and auto-assign default standard quota', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.benefitTier.findFirst.mockResolvedValue({
        id: 'tier-standard-1',
        annualLimit: 3000.0,
      });
      mockPrismaService.user.create.mockResolvedValue({
        id: 'new-user-123',
        email: 'newbie@healthclaim.pro',
        firstName: 'New',
        lastName: 'User',
        role: UserRole.EMPLOYEE,
        department: 'Support',
        isEmailVerified: false,
      });

      const result = await authService.register({
        email: 'newbie@healthclaim.pro',
        password: 'SecurePassword123!',
        firstName: 'New',
        lastName: 'User',
        role: UserRole.EMPLOYEE,
        department: 'Support',
      });

      expect(result).toBeDefined();
      expect(result.accessToken).toBe('mocked-jwt-token-xyz');
      expect(result.user.email).toBe('newbie@healthclaim.pro');
      expect(mockPrismaService.userPolicyQuota.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'new-user-123',
            benefitTierId: 'tier-standard-1',
            annualLimit: 3000.0,
          }),
        }),
      );
    });

    it('should throw ConflictException if email is already registered', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'existing-1' });

      await expect(
        authService.register({
          email: 'existing@healthclaim.pro',
          password: 'Password123!',
          firstName: 'John',
          lastName: 'Doe',
          role: UserRole.EMPLOYEE,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('sendVerificationEmail & verifyEmail (TODO email verification flow)', () => {
    it('should generate verification token for unverified user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        email: 'unverified@healthclaim.pro',
        isEmailVerified: false,
      });
      mockPrismaService.verificationToken.create.mockResolvedValue({
        id: 'tok-1',
        token: 'sample-tok',
      });

      const res = await authService.sendVerificationEmail('usr-1');
      expect(res.message).toContain('Verification email sent');
      expect(mockPrismaService.verificationToken.create).toHaveBeenCalled();
    });

    it('should return already verified message if user is already verified', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        email: 'verified@healthclaim.pro',
        isEmailVerified: true,
      });

      const res = await authService.sendVerificationEmail('usr-1');
      expect(res.message).toBe('Email is already verified');
    });

    it('should verify email successfully when valid token is presented', async () => {
      mockPrismaService.verificationToken.findUnique.mockResolvedValue({
        token: 'valid-tok',
        email: 'user@healthclaim.pro',
        expiresAt: new Date(Date.now() + 100000),
      });

      const res = await authService.verifyEmail('valid-tok');
      expect(res.message).toContain('Email has been verified successfully');
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { email: 'user@healthclaim.pro' },
        data: { isEmailVerified: true },
      });
      expect(mockPrismaService.verificationToken.delete).toHaveBeenCalledWith({
        where: { token: 'valid-tok' },
      });
    });

    it('should throw BadRequestException when token is expired or invalid', async () => {
      mockPrismaService.verificationToken.findUnique.mockResolvedValue(null);

      await expect(authService.verifyEmail('invalid-token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
