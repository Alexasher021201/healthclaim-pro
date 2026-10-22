import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface SettlementEmailPayload {
  claimId: string;
  claimNumber: string;
  claimantName: string;
  claimantEmail: string;
  approvedAmount: number;
  settlementReference: string;
  payoutMethod?: string;
  settledAt?: string;
  issuerSignature?: string;
}

export interface ClaimStatusEmailPayload {
  claimNumber: string;
  claimantName: string;
  claimantEmail: string;
  status: string;
  amount: number;
  reason?: string;
}

export interface MailDispatchResult {
  success: boolean;
  messageId?: string;
  simulated?: boolean;
  error?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null = null;
  private readonly fromAddress: string;
  private readonly frontendUrl: string;

  constructor(private readonly configService?: ConfigService) {
    const apiKey =
      this.configService?.get<string>('RESEND_API_KEY') ||
      process.env.RESEND_API_KEY;

    this.fromAddress =
      this.configService?.get<string>('EMAIL_FROM') ||
      process.env.EMAIL_FROM ||
      'HealthClaim Pro <noreply@healthclaim.pro>';

    this.frontendUrl =
      this.configService?.get<string>('FRONTEND_URL') ||
      process.env.FRONTEND_URL ||
      'https://healthclaim.pro';

    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.log(`[MailService] Initialized Resend client (Sender: "${this.fromAddress}")`);
    } else {
      this.logger.warn('[MailService] RESEND_API_KEY is not defined. Active in fallback simulation mode.');
    }
  }

  /**
   * Dispatches an itemized settlement voucher notification email to the claimant.
   */
  async sendSettlementVoucherEmail(voucher: SettlementEmailPayload): Promise<MailDispatchResult> {
    const recipient = voucher.claimantEmail;
    const subject = `[HealthClaim Pro] Settlement Approved: Claim #${voucher.claimNumber}`;

    const formattedAmount = (Number(voucher.approvedAmount) || 0).toFixed(2);
    const settledDateStr = voucher.settledAt
      ? new Date(voucher.settledAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : new Date().toLocaleDateString('en-US');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background: #0f172a; padding: 24px 32px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .badge { display: inline-block; margin-top: 8px; background: #16a34a; color: #ffffff; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; }
    .content { padding: 32px; }
    .greeting { font-size: 16px; margin-bottom: 16px; }
    .amount-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; }
    .amount-label { font-size: 13px; color: #15803d; font-weight: 600; text-transform: uppercase; margin-bottom: 4px; }
    .amount-val { font-size: 32px; color: #166534; font-weight: 800; }
    .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .details-table td { padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .details-table td.label { color: #64748b; width: 45%; }
    .details-table td.value { font-weight: 600; color: #0f172a; text-align: right; }
    .seal-box { margin-top: 24px; padding: 12px 16px; background: #f8fafc; border-left: 3px solid #3b82f6; font-size: 12px; color: #64748b; font-family: monospace; word-break: break-all; }
    .footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>HealthClaim Pro</h1>
      <div class="badge">Settlement Approved</div>
    </div>
    <div class="content">
      <div class="greeting">Dear <strong>${voucher.claimantName}</strong>,</div>
      <p style="font-size: 14px; line-height: 1.6; color: #475569;">
        Your healthcare claim has been reviewed, adjudicated through our automated rule engine, and approved for reimbursement.
      </p>
      <div class="amount-box">
        <div class="amount-label">Approved Reimbursement Amount</div>
        <div class="amount-val">$${formattedAmount}</div>
      </div>
      <table class="details-table">
        <tr><td class="label">Claim Number</td><td class="value">${voucher.claimNumber}</td></tr>
        <tr><td class="label">Settlement Reference</td><td class="value">${voucher.settlementReference}</td></tr>
        <tr><td class="label">Payout Method</td><td class="value">${voucher.payoutMethod || 'Direct Bank Disbursement'}</td></tr>
        <tr><td class="label">Settlement Date</td><td class="value">${settledDateStr}</td></tr>
      </table>
      ${
        voucher.issuerSignature
          ? `<div class="seal-box"><strong>Digital Audit Stamp:</strong><br/>${voucher.issuerSignature}</div>`
          : ''
      }
    </div>
    <div class="footer">
      This is an automated notification from HealthClaim Pro Adjudication Platform.<br/>
      © 2026 HealthClaim Pro. All rights reserved.
    </div>
  </div>
</body>
</html>
`;

    return this.dispatchEmail(recipient, subject, html);
  }

  /**
   * Dispatches claim status transition updates (e.g. APPROVED, REJECTED).
   */
  async sendClaimStatusEmail(payload: ClaimStatusEmailPayload): Promise<MailDispatchResult> {
    const isApproved = payload.status === 'APPROVED' || payload.status === 'SETTLED';
    const badgeColor = isApproved ? '#16a34a' : '#dc2626';
    const badgeText = isApproved ? 'CLAIM APPROVED' : 'ACTION REQUIRED';
    const subject = `[HealthClaim Pro] Status Update: Claim #${payload.claimNumber} is ${payload.status}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background: #0f172a; padding: 24px 32px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; }
    .badge { display: inline-block; margin-top: 8px; background: ${badgeColor}; color: #ffffff; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 9999px; }
    .content { padding: 32px; }
    .footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>HealthClaim Pro</h1>
      <div class="badge">${badgeText}</div>
    </div>
    <div class="content">
      <p>Dear <strong>${payload.claimantName}</strong>,</p>
      <p>The adjudication status for claim <strong>#${payload.claimNumber}</strong> (Amount: $${payload.amount.toFixed(2)}) has transitioned to <strong>${payload.status}</strong>.</p>
      ${payload.reason ? `<p style="padding: 12px; background: #f1f5f9; border-radius: 6px; font-size: 13px;"><strong>Note:</strong> ${payload.reason}</p>` : ''}
      <p style="margin-top: 24px;">You can view the full claim breakdown and audit history in your <a href="${this.frontendUrl}" style="color: #2563eb;">HealthClaim Pro Portal</a>.</p>
    </div>
    <div class="footer">
      © 2026 HealthClaim Pro. Enterprise Health Insurance Platform.
    </div>
  </div>
</body>
</html>
`;

    return this.dispatchEmail(payload.claimantEmail, subject, html);
  }

  /**
   * Dispatches an account email verification link to a registered user.
   */
  async sendVerificationEmail(
    toEmail: string,
    token: string,
    firstName?: string,
  ): Promise<MailDispatchResult> {
    const subject = '[HealthClaim Pro] Verify your email address';
    const verifyUrl = `${this.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background: #0f172a; padding: 24px 32px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; }
    .content { padding: 32px; }
    .button { display: inline-block; background: #2563eb; color: #ffffff !important; padding: 12px 28px; border-radius: 6px; font-weight: 600; text-decoration: none; margin: 24px 0; font-size: 15px; }
    .footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>HealthClaim Pro</h1>
    </div>
    <div class="content">
      <h2 style="font-size: 18px; margin-top: 0;">Verify your email address</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #475569;">
        Hello ${firstName || 'Valued Member'},<br/><br/>
        Thank you for joining HealthClaim Pro. Please confirm your email address by clicking the button below:
      </p>
      <div style="text-align: center;">
        <a href="${verifyUrl}" class="button" target="_blank">Verify Email Address</a>
      </div>
      <p style="font-size: 12px; color: #64748b;">
        Or copy and paste this link into your browser:<br/>
        <a href="${verifyUrl}" style="color: #2563eb; word-break: break-all;">${verifyUrl}</a>
      </p>
      <p style="font-size: 12px; color: #94a3b8;">
        This verification link is valid for 24 hours. If you did not create an account, you can safely ignore this email.
      </p>
    </div>
    <div class="footer">
      © 2026 HealthClaim Pro. Enterprise Health Insurance Platform.
    </div>
  </div>
</body>
</html>
`;

    return this.dispatchEmail(toEmail, subject, html);
  }

  /**
   * Core dispatcher handling real Resend calls or simulation fallback.
   */
  private async dispatchEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<MailDispatchResult> {
    if (!this.resend) {
      this.logger.log(
        `[MailService:SIMULATION] Recipient: ${to} | Subject: "${subject}" (RESEND_API_KEY not configured)`,
      );
      return { success: true, simulated: true };
    }

    try {
      const response = await this.resend.emails.send({
        from: this.fromAddress,
        to: [to],
        subject,
        html,
      });

      if (response.error) {
        this.logger.error(
          `[MailService] Resend API error sending to ${to}: ${response.error.message}`,
        );
        return { success: false, error: response.error.message };
      }

      this.logger.log(
        `[MailService] Successfully dispatched email to ${to} (MessageId: ${response.data?.id})`,
      );
      return { success: true, messageId: response.data?.id };
    } catch (err: any) {
      this.logger.error(
        `[MailService] Unexpected exception sending email to ${to}: ${err.message}`,
      );
      return { success: false, error: err.message };
    }
  }
}
