import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import {
  UserRole,
  UserStatus,
  UpdateUserRole,
  UpdateUserStatus,
  AdminCreateUser,
  AdminUpdateUserDto,
  UpdateProfileDto,
} from '@healthclaim/shared';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly mailService?: MailService,
  ) {}

  /**
   * Get authenticated user profile with active quota details
   */
  async getCurrentUserProfile(userId: string) {
    const currentYear = new Date().getFullYear();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        department: true,
        isEmailVerified: true,
        createdAt: true,
        updatedAt: true,
        quotas: {
          where: { fiscalYear: currentYear },
          include: {
            benefitTier: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const activeQuota = user.role === UserRole.EMPLOYEE ? user.quotas[0] || null : null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      department: user.department,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      activeQuota: activeQuota
        ? {
            id: activeQuota.id,
            fiscalYear: activeQuota.fiscalYear,
            annualLimit: Number(activeQuota.annualLimit),
            remainingBalance: Number(activeQuota.remainingBalance),
            cumulativeDeductibleSpent: Number(activeQuota.cumulativeDeductibleSpent),
            benefitTier: {
              id: activeQuota.benefitTier.id,
              name: activeQuota.benefitTier.name,
              code: activeQuota.benefitTier.code,
              description: activeQuota.benefitTier.description,
              annualLimit: Number(activeQuota.benefitTier.annualLimit),
              defaultDeductible: Number(activeQuota.benefitTier.defaultDeductible),
              defaultCoPayRate: Number(activeQuota.benefitTier.defaultCoPayRate),
            },
          }
        : null,
    };
  }

  /**
   * Update self profile settings (Name, email, department, password)
   */
  async updateMyProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const updateData: any = {};

    if (dto.firstName) updateData.firstName = dto.firstName.trim();
    if (dto.lastName) updateData.lastName = dto.lastName.trim();
    if (dto.department !== undefined) updateData.department = dto.department?.trim() || null;

    let emailChanged = false;
    let targetEmail: string | undefined;

    if (dto.email && dto.email.toLowerCase().trim() !== user.email) {
      targetEmail = dto.email.toLowerCase().trim();
      const emailConflict = await this.prisma.user.findUnique({ where: { email: targetEmail } });
      if (emailConflict) {
        throw new ConflictException('An account with this email address already exists');
      }
      updateData.email = targetEmail;
      updateData.isEmailVerified = false; // Reset verification if email changes
      emailChanged = true;
    }

    // Password change verification
    if (dto.newPassword) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Current password is required to change password');
      }
      const isMatch = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!isMatch) {
        throw new UnauthorizedException('Incorrect current password');
      }
      updateData.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    // If email changed, automatically issue a new verification token and send verification email
    if (emailChanged && targetEmail) {
      const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      if (this.prisma.verificationToken?.deleteMany) {
        await this.prisma.verificationToken.deleteMany({
          where: { email: targetEmail },
        });
      }

      if (this.prisma.verificationToken?.create) {
        await this.prisma.verificationToken.create({
          data: {
            email: targetEmail,
            token,
            expiresAt,
          },
        });
      }

      if (this.mailService) {
        try {
          await this.mailService.sendVerificationEmail(
            targetEmail,
            token,
            updatedUser.firstName || user.firstName,
          );
        } catch (e: any) {
          console.warn(`[UsersService] Failed to send verification email to ${targetEmail}: ${e.message}`);
        }
      } else {
        console.log(`[EMAIL_VERIFICATION_SIMULATION] Verification link for ${targetEmail}: https://healthclaim.pro/verify-email?token=${token}`);
      }
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'UPDATE_SELF_PROFILE',
        targetResource: 'USER',
        targetResourceId: userId,
        details: {
          updatedFields: Object.keys(updateData).filter((k) => k !== 'passwordHash'),
        },
      },
    });

    return this.getCurrentUserProfile(userId);
  }

  /**
   * List all users with filtering and pagination (Admin & Auditor)
   */
  async getAllUsers(params?: {
    role?: UserRole;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 50;
    const skip = (page - 1) * pageSize;
    const currentYear = new Date().getFullYear();

    const where: any = {};
    if (params?.role) {
      where.role = params.role;
    }
    if (params?.search) {
      where.OR = [
        { email: { contains: params.search, mode: 'insensitive' } },
        { firstName: { contains: params.search, mode: 'insensitive' } },
        { lastName: { contains: params.search, mode: 'insensitive' } },
        { department: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          department: true,
          isEmailVerified: true,
          createdAt: true,
          quotas: {
            where: { fiscalYear: currentYear },
            include: { benefitTier: true },
          },
        },
      }),
    ]);

    const formattedUsers = users.map((u) => {
      const isEmployee = u.role === UserRole.EMPLOYEE;
      const quota = isEmployee ? u.quotas[0] : null;
      return {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        status: u.status,
        department: u.department,
        isEmailVerified: u.isEmailVerified,
        createdAt: u.createdAt,
        benefitTier: isEmployee ? (quota?.benefitTier?.name || 'Unassigned') : '—',
        remainingBalance: quota ? Number(quota.remainingBalance) : 0,
        annualLimit: quota ? Number(quota.annualLimit) : 0,
      };
    });

    return {
      items: formattedUsers,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Update user role (Admin only)
   */
  async updateUserRole(targetUserId: string, dto: UpdateUserRole, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) {
      throw new NotFoundException('Target user not found');
    }

    if (targetUserId === actorId && dto.role !== UserRole.SYSTEM_ADMIN) {
      throw new BadRequestException('Administrators cannot revoke their own admin privileges');
    }

    const previousRole = user.role;
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: dto.role },
    });

    // Record audit log for RBAC privilege alteration
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'UPDATE_USER_ROLE',
        targetResource: 'USER',
        targetResourceId: targetUserId,
        details: {
          previousRole,
          newRole: dto.role,
          targetEmail: user.email,
        },
      },
    });

    return updated;
  }

  /**
   * Update user status (Admin only)
   */
  async updateUserStatus(targetUserId: string, dto: UpdateUserStatus, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) {
      throw new NotFoundException('Target user not found');
    }

    if (targetUserId === actorId) {
      throw new BadRequestException('Administrators cannot suspend their own account');
    }

    const previousStatus = user.status;
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status: dto.status as any },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'UPDATE_USER_STATUS',
        targetResource: 'USER',
        targetResourceId: targetUserId,
        details: {
          previousStatus,
          newStatus: dto.status,
          targetEmail: user.email,
        },
      },
    });

    return updated;
  }

  /**
   * Create user from admin console
   */
  async adminCreateUser(dto: AdminCreateUser, actorId: string) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email address already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const currentYear = new Date().getFullYear();

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        department: dto.department,
        status: UserStatus.ACTIVE,
        isEmailVerified: true,
      },
    });

    // Assign benefit tier if provided or default for employee
    let assignedTierId = dto.benefitTierId;
    if (!assignedTierId && dto.role === UserRole.EMPLOYEE) {
      const defaultTier = await this.prisma.benefitTier.findFirst({
        where: { code: 'TIER_STANDARD' },
      });
      assignedTierId = defaultTier?.id;
    }

    if (assignedTierId) {
      const tier = await this.prisma.benefitTier.findUnique({ where: { id: assignedTierId } });
      if (tier) {
        await this.prisma.userPolicyQuota.create({
          data: {
            userId: user.id,
            benefitTierId: tier.id,
            fiscalYear: currentYear,
            annualLimit: tier.annualLimit,
            remainingBalance: tier.annualLimit,
            cumulativeDeductibleSpent: 0,
          },
        });
      }
    }

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'ADMIN_CREATE_USER',
        targetResource: 'USER',
        targetResourceId: user.id,
        details: {
          email: user.email,
          role: user.role,
          department: user.department,
        },
      },
    });

    return user;
  }

  /**
   * Comprehensive user profile and credentials update (Admin only)
   */
  async adminUpdateUserProfile(
    targetUserId: string,
    dto: AdminUpdateUserDto,
    actorId: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) {
      throw new NotFoundException('Target user not found');
    }

    const updateData: any = {};
    if (dto.firstName) updateData.firstName = dto.firstName.trim();
    if (dto.lastName) updateData.lastName = dto.lastName.trim();
    if (dto.department !== undefined) updateData.department = dto.department?.trim() || null;
    if (dto.status) {
      if (targetUserId === actorId && dto.status !== UserStatus.ACTIVE) {
        throw new BadRequestException('Administrators cannot suspend their own account');
      }
      updateData.status = dto.status;
    }
    if (dto.role) {
      if (targetUserId === actorId && dto.role !== UserRole.SYSTEM_ADMIN) {
        throw new BadRequestException('Administrators cannot revoke their own admin privileges');
      }
      updateData.role = dto.role;
    }

    if (dto.email && dto.email.toLowerCase().trim() !== user.email) {
      const targetEmail = dto.email.toLowerCase().trim();
      const existing = await this.prisma.user.findUnique({ where: { email: targetEmail } });
      if (existing && existing.id !== targetUserId) {
        throw new ConflictException('An account with this email address already exists');
      }
      updateData.email = targetEmail;
    }

    if (dto.resetPassword) {
      updateData.passwordHash = await bcrypt.hash(dto.resetPassword, 10);
    }

    if (dto.role && dto.role !== UserRole.EMPLOYEE) {
      await this.prisma.userPolicyQuota.deleteMany({ where: { userId: targetUserId } });
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: updateData,
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'ADMIN_UPDATE_USER_PROFILE',
        targetResource: 'USER',
        targetResourceId: targetUserId,
        details: {
          targetEmail: updated.email,
          updatedFields: Object.keys(updateData).filter((k) => k !== 'passwordHash'),
          passwordReset: !!dto.resetPassword,
        },
      },
    });

    return {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      role: updated.role,
      status: updated.status,
      department: updated.department,
      isEmailVerified: updated.isEmailVerified,
      updatedAt: updated.updatedAt,
    };
  }
}
