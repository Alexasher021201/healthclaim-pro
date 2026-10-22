import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MailService } from '../src/common/mail/mail.service';
import { Resend } from 'resend';

vi.mock('resend');

describe('MailService (Transactional Email with Resend)', () => {
  let mailService: MailService;
  let mockResendSend: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResendSend = vi.fn().mockResolvedValue({
      data: { id: 'mock-email-msg-123' },
      error: null,
    });

    (Resend as any).mockImplementation(() => ({
      emails: {
        send: mockResendSend,
      },
    }));

    const mockConfigService: any = {
      get: vi.fn((key: string) => {
        if (key === 'RESEND_API_KEY') return 're_test_dummy_key';
        if (key === 'EMAIL_FROM') return 'HealthClaim Pro <noreply@healthclaim.pro>';
        if (key === 'FRONTEND_URL') return 'https://healthclaim.pro';
        return null;
      }),
    };

    mailService = new MailService(mockConfigService);
  });

  it('should initialize Resend client when API key is provided', () => {
    expect(mailService).toBeDefined();
    expect(Resend).toHaveBeenCalledWith('re_test_dummy_key');
  });

  it('should successfully dispatch settlement voucher email via Resend', async () => {
    const voucher = {
      claimId: 'clm-1',
      claimNumber: 'CLM-2026-0001',
      claimantName: 'John Doe',
      claimantEmail: 'john@example.com',
      approvedAmount: 450.0,
      settlementReference: 'SETTLE-REF-123',
      payoutMethod: 'DIRECT_BANK_TRANSFER',
      settledAt: '2026-10-22T07:00:00.000Z',
      issuerSignature: 'SEAL-ABC-123',
    };

    const result = await mailService.sendSettlementVoucherEmail(voucher);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('mock-email-msg-123');
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'HealthClaim Pro <noreply@healthclaim.pro>',
        to: ['john@example.com'],
        subject: expect.stringContaining('CLM-2026-0001'),
        html: expect.stringContaining('$450.00'),
      }),
    );
  });

  it('should successfully dispatch claim status notification', async () => {
    const result = await mailService.sendClaimStatusEmail({
      claimNumber: 'CLM-2026-0002',
      claimantName: 'Bob',
      claimantEmail: 'bob@example.com',
      status: 'REJECTED',
      amount: 120.0,
      reason: 'Receipt is illegible',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('mock-email-msg-123');
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['bob@example.com'],
        subject: expect.stringContaining('REJECTED'),
        html: expect.stringContaining('Receipt is illegible'),
      }),
    );
  });

  it('should successfully dispatch account email verification link', async () => {
    const result = await mailService.sendVerificationEmail(
      'alice@example.com',
      'secure-token-abc',
      'Alice',
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('mock-email-msg-123');
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['alice@example.com'],
        subject: expect.stringContaining('Verify your email address'),
        html: expect.stringContaining('token=secure-token-abc'),
      }),
    );
  });

  it('should handle Resend API error gracefully without throwing exception', async () => {
    mockResendSend.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid recipient domain' },
    });

    const result = await mailService.sendVerificationEmail('invalid@domain', 'token-123');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid recipient domain');
  });

  it('should fallback to simulation when RESEND_API_KEY is missing', async () => {
    const mockEmptyConfig: any = { get: vi.fn().mockReturnValue(undefined) };
    const oldEnvKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    const fallbackService = new MailService(mockEmptyConfig);
    const result = await fallbackService.sendVerificationEmail('fallback@example.com', 'tok');

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(true);

    if (oldEnvKey) process.env.RESEND_API_KEY = oldEnvKey;
  });
});
