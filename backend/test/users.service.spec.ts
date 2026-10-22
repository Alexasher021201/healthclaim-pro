import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from '../src/users/users.service';
import { UserRole, UserStatus } from '@healthclaim/shared';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';

describe('UsersService (TDD)', () => {
  let service: UsersService;
  let mockPrismaService: any;
  let mockMailService: any;

  beforeEach(() => {
    mockMailService = {
      sendVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
    };

    mockPrismaService = {
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      verificationToken: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'tok-1' }),
      },
      benefitTier: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      userPolicyQuota: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };

    service = new UsersService(mockPrismaService, mockMailService);
  });

  describe('getCurrentUserProfile', () => {
    it('should return user profile with active quota', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        email: 'employee@healthclaim.pro',
        firstName: 'David',
        lastName: 'Miller',
        role: UserRole.EMPLOYEE,
        status: UserStatus.ACTIVE,
        department: 'Engineering',
        isEmailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        quotas: [
          {
            id: 'quota-1',
            fiscalYear: 2026,
            annualLimit: 3000,
            remainingBalance: 2450,
            cumulativeDeductibleSpent: 100,
            benefitTier: {
              id: 'tier-1',
              name: 'Standard Tier',
              code: 'TIER_STANDARD',
              description: 'Standard plan',
              annualLimit: 3000,
              defaultDeductible: 100,
              defaultCoPayRate: 0.8,
            },
          },
        ],
      });

      const profile = await service.getCurrentUserProfile('usr-1');
      expect(profile).toBeDefined();
      expect(profile.email).toBe('employee@healthclaim.pro');
      expect(profile.activeQuota?.remainingBalance).toBe(2450);
      expect(profile.activeQuota?.benefitTier?.name).toBe('Standard Tier');
    });

    it('should return profile with null activeQuota if employee has no quota assigned', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        email: 'admin@healthclaim.pro',
        firstName: 'Alex',
        lastName: 'Admin',
        role: UserRole.SYSTEM_ADMIN,
        status: UserStatus.ACTIVE,
        quotas: [],
      });

      const profile = await service.getCurrentUserProfile('usr-1');
      expect(profile.activeQuota).toBeNull();
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getCurrentUserProfile('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAllUsers', () => {
    it('should query and return paginated user list with role and search filters', async () => {
      mockPrismaService.user.count.mockResolvedValue(1);
      mockPrismaService.user.findMany.mockResolvedValue([
        {
          id: 'usr-1',
          email: 'officer@healthclaim.pro',
          firstName: 'Sarah',
          lastName: 'Jenkins',
          role: UserRole.CLAIM_OFFICER,
          status: UserStatus.ACTIVE,
          department: 'Claims',
          isEmailVerified: true,
          createdAt: new Date(),
          quotas: [],
        },
      ]);

      const result = await service.getAllUsers({
        role: UserRole.CLAIM_OFFICER,
        search: 'Sarah',
        page: 1,
        pageSize: 10,
      });

      expect(result.total).toBe(1);
      expect(result.items[0].email).toBe('officer@healthclaim.pro');
      expect(result.items[0].benefitTier).toBe('—');
      expect(result.items[0].annualLimit).toBe(0);
    });
  });

  describe('updateUserRole', () => {
    it('should update role and record audit log', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'usr-2',
        email: 'officer@healthclaim.pro',
        role: UserRole.EMPLOYEE,
      });
      mockPrismaService.user.update.mockResolvedValue({
        id: 'usr-2',
        role: UserRole.CLAIM_OFFICER,
      });

      const result = await service.updateUserRole(
        'usr-2',
        { role: UserRole.CLAIM_OFFICER },
        'admin-usr-id',
      );

      expect(result.role).toBe(UserRole.CLAIM_OFFICER);
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'UPDATE_USER_ROLE',
            targetResourceId: 'usr-2',
          }),
        }),
      );
    });

    it('should throw NotFoundException if target user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUserRole('non-existent', { role: UserRole.EMPLOYEE }, 'admin-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should prevent admin from revoking their own admin privileges', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'admin-id',
        role: UserRole.SYSTEM_ADMIN,
      });

      await expect(
        service.updateUserRole(
          'admin-id',
          { role: UserRole.EMPLOYEE },
          'admin-id', // Actor is same as target
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateUserStatus', () => {
    it('should update account status and record audit log', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'usr-3',
        email: 'badactor@healthclaim.pro',
        status: UserStatus.ACTIVE,
      });
      mockPrismaService.user.update.mockResolvedValue({
        id: 'usr-3',
        status: UserStatus.SUSPENDED,
      });

      const result = await service.updateUserStatus(
        'usr-3',
        { status: UserStatus.SUSPENDED },
        'admin-id',
      );

      expect(result.status).toBe(UserStatus.SUSPENDED);
      expect(mockPrismaService.auditLog.create).toHaveBeenCalled();
    });

    it('should prevent admin from suspending themselves', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'admin-id',
        status: UserStatus.ACTIVE,
      });

      await expect(
        service.updateUserStatus('admin-id', { status: UserStatus.SUSPENDED }, 'admin-id'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('adminCreateUser', () => {
    it('should create new user with role and initial quota', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.benefitTier.findUnique.mockResolvedValue({
        id: 'tier-1',
        annualLimit: 5000,
      });
      mockPrismaService.user.create.mockResolvedValue({
        id: 'new-emp-1',
        email: 'emp@test.com',
        role: UserRole.EMPLOYEE,
      });

      const result = await service.adminCreateUser(
        {
          email: 'emp@test.com',
          password: 'Password123!',
          firstName: 'Jane',
          lastName: 'Doe',
          role: UserRole.EMPLOYEE,
          benefitTierId: 'tier-1',
        },
        'admin-id',
      );

      expect(result).toBeDefined();
      expect(mockPrismaService.userPolicyQuota.create).toHaveBeenCalled();
      expect(mockPrismaService.auditLog.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if email exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'exists' });

      await expect(
        service.adminCreateUser(
          {
            email: 'exists@test.com',
            password: 'Password123!',
            firstName: 'A',
            lastName: 'B',
            role: UserRole.EMPLOYEE,
          },
          'admin-id',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateMyProfile', () => {
    it('should update name and department successfully', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          id: 'usr-1',
          email: 'emp@test.com',
          firstName: 'Old',
          lastName: 'Name',
        })
        .mockResolvedValueOnce({
          id: 'usr-1',
          email: 'emp@test.com',
          firstName: 'New',
          lastName: 'Name',
          role: UserRole.EMPLOYEE,
          status: UserStatus.ACTIVE,
          department: 'Product Design',
          isEmailVerified: true,
          quotas: [],
        });

      mockPrismaService.user.update.mockResolvedValue({
        id: 'usr-1',
        firstName: 'New',
      });

      const updated = await service.updateMyProfile('usr-1', {
        firstName: 'New',
        department: 'Product Design',
      });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'usr-1' },
          data: expect.objectContaining({
            firstName: 'New',
            department: 'Product Design',
          }),
        }),
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalled();
      expect(updated.firstName).toBe('New');
    });

    it('should reset isEmailVerified and auto-send verification email when email changes', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          id: 'usr-1',
          email: 'old@test.com',
          firstName: 'Alice',
          lastName: 'Smith',
        })
        .mockResolvedValueOnce(null) // no email conflict
        .mockResolvedValueOnce({
          id: 'usr-1',
          email: 'new@test.com',
          firstName: 'Alice',
          lastName: 'Smith',
          role: UserRole.EMPLOYEE,
          status: UserStatus.ACTIVE,
          department: 'Engineering',
          isEmailVerified: false,
          quotas: [],
        });

      mockPrismaService.user.update.mockResolvedValue({
        id: 'usr-1',
        email: 'new@test.com',
        firstName: 'Alice',
        isEmailVerified: false,
      });

      const updated = await service.updateMyProfile('usr-1', {
        email: 'new@test.com',
      });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'usr-1' },
          data: expect.objectContaining({
            email: 'new@test.com',
            isEmailVerified: false,
          }),
        }),
      );
      expect(mockPrismaService.verificationToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'new@test.com',
          }),
        }),
      );
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith(
        'new@test.com',
        expect.any(String),
        'Alice',
      );
      expect(updated.isEmailVerified).toBe(false);
      expect(updated.email).toBe('new@test.com');
    });
  });

  describe('adminUpdateUserProfile', () => {
    it('should update personal info, department, and reset password with audit log', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: 'usr-target',
        email: 'target@healthclaim.pro',
        firstName: 'OldFirst',
        lastName: 'OldLast',
        role: UserRole.EMPLOYEE,
        status: UserStatus.ACTIVE,
      });

      mockPrismaService.user.update.mockResolvedValue({
        id: 'usr-target',
        email: 'newemail@healthclaim.pro',
        firstName: 'NewFirst',
        lastName: 'NewLast',
        role: UserRole.EMPLOYEE,
        status: UserStatus.SUSPENDED,
        department: 'Finance & Treasury',
        isEmailVerified: true,
        updatedAt: new Date(),
      });

      const res = await service.adminUpdateUserProfile(
        'usr-target',
        {
          firstName: 'NewFirst',
          lastName: 'NewLast',
          email: 'newemail@healthclaim.pro',
          department: 'Finance & Treasury',
          status: UserStatus.SUSPENDED,
          resetPassword: 'NewSecurePassword123!',
        },
        'admin-1',
      );

      expect(res.firstName).toBe('NewFirst');
      expect(res.status).toBe(UserStatus.SUSPENDED);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'usr-target' },
          data: expect.objectContaining({
            firstName: 'NewFirst',
            lastName: 'NewLast',
            department: 'Finance & Treasury',
            status: UserStatus.SUSPENDED,
          }),
        }),
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ADMIN_UPDATE_USER_PROFILE',
            targetResourceId: 'usr-target',
          }),
        }),
      );
    });
  });
});
