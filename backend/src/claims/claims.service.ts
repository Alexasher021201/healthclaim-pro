import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RuleEngineService } from '../rules/rules.service';
import { ActuarialService } from '../actuarial/actuarial.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { ClaimStateMachine } from './state-machine/claim-state-machine';
import { MailService } from '../common/mail/mail.service';
import {
  CreateClaimRequest,
  ClaimResponseDto,
  ClaimStatus,
  UserRole,
  ActuarialCalculationPreviewDto,
} from '@healthclaim/shared';

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleEngine: RuleEngineService,
    private readonly actuarialService: ActuarialService,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService,
    private readonly stateMachine: ClaimStateMachine,
    @Optional() private readonly mailService?: MailService,
  ) {}

  /**
   * Validates that the invoice date is within valid policy coverage and retrieves user's policy quota.
   */
  private async validateAndGetQuota(userId: string, invoiceDateStr: string) {
    const invoiceDate = new Date(invoiceDateStr);
    if (isNaN(invoiceDate.getTime())) {
      throw new BadRequestException('Invalid invoice date format.');
    }

    const invoiceYear = invoiceDate.getFullYear();

    // 1. Query the policy quota specifically for this invoice's fiscal year
    const quota = await this.prisma.userPolicyQuota.findUnique({
      where: { userId_fiscalYear: { userId, fiscalYear: invoiceYear } },
      include: { benefitTier: true },
    });

    if (!quota) {
      // Query all enrolled fiscal years for this employee to provide an accurate, helpful notice
      const userQuotas = await this.prisma.userPolicyQuota.findMany({
        where: { userId },
        select: { fiscalYear: true },
        orderBy: { fiscalYear: 'asc' },
      });

      const enrolledYears = userQuotas.map((q) => q.fiscalYear);

      if (enrolledYears.length > 0) {
        throw new BadRequestException(
          `Invoice date (${invoiceDateStr.split('T')[0]}) falls in fiscal year ${invoiceYear}, which is outside your active policy coverage years (${enrolledYears.join(', ')}). Please select a date within your enrolled coverage periods or contact HR for prior-year exceptions.`,
        );
      } else {
        throw new BadRequestException(
          `No active medical policy quota found on your account. Please contact your HR or Benefits Administrator to enroll in a corporate medical plan.`,
        );
      }
    }

    return { quota, invoiceDate, invoiceYear };
  }

  /**
   * Generates real-time actuarial calculation quote for a claim without persisting.
   */
  async previewCalculation(
    userId: string,
    dto: CreateClaimRequest,
  ): Promise<ActuarialCalculationPreviewDto> {
    const { quota } = await this.validateAndGetQuota(userId, dto.invoiceDate);

    return this.actuarialService.calculate(
      dto.category,
      dto.items,
      {
        name: quota.benefitTier.name,
        code: quota.benefitTier.code,
        annualLimit: Number(quota.benefitTier.annualLimit),
        defaultDeductible: Number(quota.benefitTier.defaultDeductible),
        defaultCoPayRate: Number(quota.benefitTier.defaultCoPayRate),
      },
      {
        remainingBalance: Number(quota.remainingBalance),
        annualLimit: Number(quota.annualLimit),
        cumulativeDeductibleSpent: Number(quota.cumulativeDeductibleSpent),
      },
    );
  }

  /**
   * Submits a new claim: evaluates AST rules, runs actuarial calculation, and stores claim records.
   */
  async submitClaim(
    userId: string,
    dto: CreateClaimRequest,
    ipAddress?: string,
  ): Promise<ClaimResponseDto> {
    const { quota, invoiceDate, invoiceYear } = await this.validateAndGetQuota(userId, dto.invoiceDate);

    const totalAmount = dto.items.reduce((sum, item) => sum + item.totalPrice, 0);

    // 1. Evaluate Dynamic Compliance Rules (AST Engine)
    const ruleEvaluation = await this.ruleEngine.evaluateCandidate({
      category: dto.category,
      totalAmount,
      hospitalName: dto.hospitalName,
      hospitalGrade: dto.hospitalGrade,
      items: dto.items,
      userQuota: {
        remainingBalance: Number(quota.remainingBalance),
        annualLimit: Number(quota.annualLimit),
        cumulativeDeductibleSpent: Number(quota.cumulativeDeductibleSpent),
      },
    });

    // 2. Run Actuarial Calculation Pipeline
    const calculation = this.actuarialService.calculate(
      dto.category,
      dto.items,
      {
        name: quota.benefitTier.name,
        code: quota.benefitTier.code,
        annualLimit: Number(quota.benefitTier.annualLimit),
        defaultDeductible: Number(quota.benefitTier.defaultDeductible),
        defaultCoPayRate: Number(quota.benefitTier.defaultCoPayRate),
      },
      {
        remainingBalance: Number(quota.remainingBalance),
        annualLimit: Number(quota.annualLimit),
        cumulativeDeductibleSpent: Number(quota.cumulativeDeductibleSpent),
      },
    );

    // Determine initial status based on automated rule audit
    const initialStatus = ruleEvaluation.allPassed
      ? ClaimStatus.AUTO_VALIDATED
      : ClaimStatus.FLAGGED_REVIEW;

    const claimNumber = `CLM-${invoiceYear}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // 3. Persist Claim in Database Transaction
    const claim = await this.prisma.$transaction(async (tx) => {
      const createdClaim = await tx.claim.create({
        data: {
          claimNumber,
          userId,
          fiscalYear: invoiceYear,
          category: dto.category as any,
          hospitalName: dto.hospitalName,
          hospitalGrade: dto.hospitalGrade || 'GRADE_A',
          invoiceDate,
          totalAmount,
          deductibleCovered: calculation.deductibleApplied,
          coPayRate: calculation.applicableCoPayRate,
          approvedAmount: calculation.reimbursedAmount,
          outOfPocketAmount: calculation.employeeOutOfPocket,
          status: initialStatus as any,
          notes: dto.notes,
          items: {
            create: calculation.breakdownByItem.map((item) => ({
              description: item.description,
              category: item.category as any,
              unitPrice: item.totalPrice,
              quantity: 1,
              totalPrice: item.totalPrice,
              isEligible: item.isEligible,
              rejectionReason: !item.isEligible ? 'Exceeds category reimbursement threshold' : null,
            })),
          },
          ruleEvaluations: {
            create: ruleEvaluation.results.map((r) => ({
              ruleId: r.ruleId,
              ruleCode: r.ruleCode,
              ruleName: r.ruleName,
              isPassed: r.isPassed,
              reason: r.reason,
              details: r.details,
            })),
          },
        },
        include: {
          items: true,
          ruleEvaluations: true,
          attachments: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              department: true,
            },
          },
        },
      });

      // Link uploaded receipt attachments to claim
      if (dto.attachmentIds && dto.attachmentIds.length > 0) {
        await tx.receiptAttachment.updateMany({
          where: {
            id: { in: dto.attachmentIds },
            userId,
          },
          data: {
            claimId: createdClaim.id,
          },
        });

        const reloaded = await tx.claim.findUnique({
          where: { id: createdClaim.id },
          include: {
            items: true,
            ruleEvaluations: true,
            attachments: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                department: true,
              },
            },
          },
        });
        if (reloaded) return reloaded;
      }

      return createdClaim;
    });

    // 4. Record Immutable Audit Log
    await this.auditService.log({
      actorId: userId,
      action: 'SUBMIT_CLAIM',
      targetResource: 'CLAIM',
      targetResourceId: claim.id,
      details: {
        claimNumber,
        category: dto.category,
        totalAmount,
        approvedAmount: calculation.reimbursedAmount,
        status: initialStatus,
        allRulesPassed: ruleEvaluation.allPassed,
        attachmentsCount: dto.attachmentIds?.length || 0,
      },
      ipAddress,
    });

    // Asynchronous transactional notification email dispatch upon claim submission
    if (this.mailService && claim.user?.email) {
      const claimantName = `${claim.user.firstName || ''} ${claim.user.lastName || ''}`.trim() || 'Valued Member';
      this.mailService
        .sendClaimStatusEmail({
          claimNumber: claim.claimNumber,
          claimantName,
          claimantEmail: claim.user.email,
          status: initialStatus,
          amount: Number(claim.totalAmount),
          reason: ruleEvaluation.allPassed
            ? 'All adjudication rules verified. Awaiting officer endorsement.'
            : 'Certain automated rules flagged warnings. Manual officer inspection scheduled.',
        })
        .catch((err) => this.logger.error(`Claim submission email dispatch error: ${err.message}`));
    }

    return this.mapToDto(claim);
  }

  /**
   * Transitions a claim's status using the GoF Finite State Machine.
   */
  async transitionStatus(
    claimId: string,
    targetStatus: ClaimStatus,
    actor: { id: string; role: UserRole },
    reason?: string,
    ipAddress?: string,
  ): Promise<ClaimResponseDto> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        items: true,
        ruleEvaluations: true,
        attachments: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            department: true,
          },
        },
      },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID '${claimId}' not found.`);
    }

    const updatedClaim = await this.prisma.$transaction(async (tx) => {
      const transitioned = await this.stateMachine.transition(
        claim,
        targetStatus,
        actor,
        reason,
        tx,
      );

      await this.auditService.log({
        actorId: actor.id,
        action: 'TRANSITION_CLAIM_STATUS',
        targetResource: 'Claim',
        targetResourceId: claim.id,
        details: {
          previousStatus: claim.status,
          targetStatus,
          reason,
        },
        ipAddress,
      });

      return transitioned;
    });

    // Asynchronous transactional notification email dispatch
    if (this.mailService && claim.user?.email) {
      const claimantName = `${claim.user.firstName || ''} ${claim.user.lastName || ''}`.trim() || 'Valued Member';
      if (
        targetStatus === ClaimStatus.SETTLED ||
        targetStatus === ClaimStatus.FINANCE_APPROVED ||
        targetStatus === ClaimStatus.OFFICER_APPROVED
      ) {
        this.mailService
          .sendSettlementVoucherEmail({
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            claimantName,
            claimantEmail: claim.user.email,
            approvedAmount: Number(claim.approvedAmount || claim.totalAmount),
            settlementReference: `SETTLE-${claim.claimNumber}`,
            payoutMethod: 'Direct Bank Disbursement',
            settledAt: new Date().toISOString(),
            issuerSignature: `HEALTHCLAIM-PRO-SEAL-${Buffer.from(claim.claimNumber).toString('base64').substring(0, 16)}`,
          })
          .catch((err) => this.logger.error(`Settlement email dispatch error: ${err.message}`));
      } else if (
        targetStatus === ClaimStatus.OFFICER_REJECTED ||
        targetStatus === ClaimStatus.CANCELLED ||
        targetStatus === ClaimStatus.FLAGGED_REVIEW
      ) {
        this.mailService
          .sendClaimStatusEmail({
            claimNumber: claim.claimNumber,
            claimantName,
            claimantEmail: claim.user.email,
            status: targetStatus,
            amount: Number(claim.totalAmount),
            reason,
          })
          .catch((err) => this.logger.error(`Claim rejection email dispatch error: ${err.message}`));
      }
    }

    return this.mapToDto(updatedClaim);
  }

  /**
   * Retrieves claims filed by the authenticated employee.
   */
  async getMyClaims(userId: string): Promise<ClaimResponseDto[]> {
    const claims = await this.prisma.claim.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        ruleEvaluations: true,
        attachments: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            department: true,
          },
        },
      },
    });

    return claims.map((c) => this.mapToDto(c));
  }

  /**
   * Retrieves list of all claims with status/search filtering for reviewers/admins.
   */
  async getAllClaims(status?: string, search?: string): Promise<ClaimResponseDto[]> {
    const where: any = {};

    if (status && status !== 'ALL') {
      const statusStr = typeof status === 'string' ? status : Array.isArray(status) ? (status as string[]).join(',') : String(status);
      if (statusStr.includes(',')) {
        where.status = { in: statusStr.split(',').map((s) => s.trim()) as any };
      } else {
        where.status = statusStr as any;
      }
    }

    if (search) {
      const searchStr = typeof search === 'string' ? search : String(search);
      where.OR = [
        { claimNumber: { contains: searchStr, mode: 'insensitive' } },
        { hospitalName: { contains: searchStr, mode: 'insensitive' } },
        { user: { email: { contains: searchStr, mode: 'insensitive' } } },
      ];
    }

    const claims = await this.prisma.claim.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        ruleEvaluations: true,
        attachments: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            department: true,
          },
        },
      },
    });

    return claims.map((c) => this.mapToDto(c));
  }

  /**
   * Retrieves a single claim by ID with RBAC guard.
   */
  async getClaimById(id: string, user: { id: string; role: UserRole }): Promise<ClaimResponseDto> {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        items: true,
        ruleEvaluations: true,
        attachments: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            department: true,
          },
        },
      },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID '${id}' not found`);
    }

    if (user.role === UserRole.EMPLOYEE && claim.userId !== user.id) {
      throw new ForbiddenException('You do not have permission to view this claim voucher.');
    }

    return this.mapToDto(claim);
  }

  /**
   * Super Admin Only: Force purge a claim and cascade physical file deletion
   */
  async forcePurgeClaim(claimId: string, adminUserId: string, ipAddress?: string): Promise<{ success: boolean; message: string }> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { attachments: true },
    });

    if (!claim) {
      throw new NotFoundException(`Claim '${claimId}' not found.`);
    }

    // 1. Physically delete all encrypted files from storage
    if (claim.attachments && claim.attachments.length > 0) {
      for (const att of claim.attachments) {
        await this.storageService.deleteStoredFile(att.storageKey);
      }
    }

    // 2. Cascade delete database record
    await this.prisma.claim.delete({
      where: { id: claimId },
    });

    // 3. Log high-severity audit record
    await this.auditService.log({
      actorId: adminUserId,
      action: 'FORCE_PURGE_CLAIM',
      targetResource: 'Claim',
      targetResourceId: claimId,
      details: {
        claimNumber: claim.claimNumber,
        attachmentsPurged: claim.attachments.length,
        totalAmount: Number(claim.totalAmount),
      },
      ipAddress,
    });

    return {
      success: true,
      message: `Claim ${claim.claimNumber} and all ${claim.attachments.length} encrypted receipts permanently purged.`,
    };
  }

  /**
   * Maps Prisma database entity to standard response DTO.
   */
  private mapToDto(claim: any): ClaimResponseDto {
    return {
      id: claim.id,
      claimNumber: claim.claimNumber,
      userId: claim.userId,
      fiscalYear: claim.fiscalYear,
      category: claim.category,
      hospitalName: claim.hospitalName,
      hospitalGrade: claim.hospitalGrade,
      invoiceDate: claim.invoiceDate.toISOString(),
      totalAmount: Number(claim.totalAmount),
      deductibleCovered: Number(claim.deductibleCovered),
      coPayRate: Number(claim.coPayRate),
      approvedAmount: Number(claim.approvedAmount),
      outOfPocketAmount: Number(claim.outOfPocketAmount),
      status: claim.status,
      statusReason: claim.statusReason,
      reviewedBy: claim.reviewedBy,
      reviewedAt: claim.reviewedAt ? claim.reviewedAt.toISOString() : null,
      notes: claim.notes,
      items: claim.items.map((it: any) => ({
        id: it.id,
        description: it.description,
        category: it.category,
        unitPrice: Number(it.unitPrice),
        quantity: it.quantity,
        totalPrice: Number(it.totalPrice),
        isEligible: it.isEligible,
        rejectionReason: it.rejectionReason,
      })),
      ruleEvaluations: claim.ruleEvaluations.map((r: any) => ({
        ruleId: r.ruleId,
        ruleCode: r.ruleCode,
        ruleName: r.ruleName,
        isPassed: r.isPassed,
        reason: r.reason,
        details: r.details,
      })),
      attachments:
        claim.attachments?.map((a: any) => ({
          id: a.id,
          claimId: a.claimId,
          fileName: a.fileName,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          checksum: a.checksum,
          createdAt: a.createdAt.toISOString(),
          previewUrl: `/api/v1/attachments/${a.id}/preview`,
        })) || [],
      user: claim.user,
      createdAt: claim.createdAt.toISOString(),
      updatedAt: claim.updatedAt.toISOString(),
    };
  }
}
