import { Injectable, BadRequestException } from '@nestjs/common';
import { ClaimCategory, ActuarialCalculationPreviewDto } from '@healthclaim/shared';
import { ActuarialItemInput, CalculationContext } from './interfaces/actuarial-strategy.interface';
import { ActuarialPipelineBuilder } from './pipeline-builder';

@Injectable()
export class ActuarialService {
  /**
   * Executes the full dynamic actuarial calculation pipeline for a given claim and user quota profile.
   */
  calculate(
    claimCategory: ClaimCategory,
    items: ActuarialItemInput[],
    benefitTier: {
      name: string;
      code: string;
      annualLimit: number;
      defaultDeductible: number;
      defaultCoPayRate: number;
    },
    userQuota: {
      remainingBalance: number;
      annualLimit: number;
      cumulativeDeductibleSpent: number;
    },
  ): ActuarialCalculationPreviewDto {
    if (!items || items.length === 0) {
      throw new BadRequestException('Claim must contain at least one item');
    }

    const context: CalculationContext = {
      claimCategory,
      items,
      benefitTier,
      userQuota,
      state: {
        totalClaimed: 0,
        eligibleAmount: 0,
        ineligibleAmount: 0,
        deductibleApplied: 0,
        remainingDeductibleBefore: 0,
        remainingDeductibleAfter: 0,
        applicableCoPayRate: benefitTier.defaultCoPayRate,
        reimbursableAmount: 0,
        employeeOutOfPocket: 0,
        isCappedByQuota: false,
        itemBreakdown: [],
      },
    };

    const pipeline = ActuarialPipelineBuilder.createStandardPipeline();
    const resultContext = pipeline(context);

    const quotaBefore = userQuota.remainingBalance;
    const quotaAfter = Math.max(0, quotaBefore - resultContext.state.reimbursableAmount);

    return {
      totalClaimedAmount: Number(resultContext.state.totalClaimed.toFixed(2)),
      eligibleAmount: Number(resultContext.state.eligibleAmount.toFixed(2)),
      ineligibleAmount: Number(resultContext.state.ineligibleAmount.toFixed(2)),
      deductibleApplied: Number(resultContext.state.deductibleApplied.toFixed(2)),
      remainingDeductibleBefore: Number(resultContext.state.remainingDeductibleBefore.toFixed(2)),
      remainingDeductibleAfter: Number(resultContext.state.remainingDeductibleAfter.toFixed(2)),
      applicableCoPayRate: resultContext.state.applicableCoPayRate,
      reimbursedAmount: Number(resultContext.state.reimbursableAmount.toFixed(2)),
      employeeOutOfPocket: Number(resultContext.state.employeeOutOfPocket.toFixed(2)),
      quotaBeforeClaim: Number(quotaBefore.toFixed(2)),
      quotaAfterClaim: Number(quotaAfter.toFixed(2)),
      benefitTierName: benefitTier.name,
      isCappedByQuota: resultContext.state.isCappedByQuota,
      breakdownByItem: resultContext.state.itemBreakdown,
    };
  }

  /**
   * Academic OOAD specification alias: calculateReimbursement
   */
  calculateReimbursement(
    claimCategory: ClaimCategory,
    items: ActuarialItemInput[],
    benefitTier: {
      name: string;
      code: string;
      annualLimit: number;
      defaultDeductible: number;
      defaultCoPayRate: number;
    },
    userQuota: {
      remainingBalance: number;
      annualLimit: number;
      cumulativeDeductibleSpent: number;
    },
  ): ActuarialCalculationPreviewDto {
    return this.calculate(claimCategory, items, benefitTier, userQuota);
  }
}

