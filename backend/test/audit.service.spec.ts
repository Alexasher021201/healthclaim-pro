import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from '../src/audit/audit.service';

describe('AuditService (TDD)', () => {
  let auditService: AuditService;
  let mockPrismaService: any;

  beforeEach(() => {
    mockPrismaService = {
      auditLog: {
        create: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    };

    auditService = new AuditService(mockPrismaService);
  });

  it('should create audit log entry with actor and metadata', async () => {
    mockPrismaService.auditLog.create.mockResolvedValue({
      id: 'log-1',
      actorId: 'usr-1',
      action: 'USER_LOGIN',
      targetResource: 'AUTH',
      targetResourceId: 'usr-1',
      details: { browser: 'Chrome' },
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla',
      createdAt: new Date(),
    });

    const res = await auditService.log({
      actorId: 'usr-1',
      action: 'USER_LOGIN',
      targetResource: 'AUTH',
      targetResourceId: 'usr-1',
      details: { browser: 'Chrome' },
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla',
    });

    expect(res).toBeDefined();
    expect(res.id).toBe('log-1');
    expect(mockPrismaService.auditLog.create).toHaveBeenCalled();
  });

  it('should query paginated audit logs with action and actor filters', async () => {
    mockPrismaService.auditLog.count.mockResolvedValue(1);
    mockPrismaService.auditLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        action: 'UPDATE_USER_ROLE',
        targetResource: 'USER',
        actor: {
          id: 'admin-1',
          email: 'admin@healthclaim.pro',
          firstName: 'Alexander',
          lastName: 'Vance',
          role: 'SYSTEM_ADMIN',
        },
      },
    ]);

    const result = await auditService.getAuditLogs({
      action: 'UPDATE_USER_ROLE',
      actorId: 'admin-1',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].action).toBe('UPDATE_USER_ROLE');
  });

  it('should export audit logs in standard CSV spreadsheet format with BOM', async () => {
    mockPrismaService.auditLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        action: 'SUBMIT_CLAIM',
        targetResource: 'CLAIM',
        targetResourceId: 'claim-123',
        details: { amount: 500 },
        ipAddress: '192.168.1.1',
        createdAt: new Date('2026-08-28T00:00:00.000Z'),
        actor: {
          id: 'usr-1',
          email: 'david@healthclaim.pro',
          firstName: 'David',
          lastName: 'Miller',
          role: 'EMPLOYEE',
        },
      },
    ]);

    const csvOutput = await auditService.exportAuditLogsCsv('SUBMIT_CLAIM');

    expect(csvOutput.startsWith('\uFEFF')).toBe(true);
    expect(csvOutput).toContain('Timestamp (ISO)');
    expect(csvOutput).toContain('SUBMIT_CLAIM');
    expect(csvOutput).toContain('David Miller');
    expect(csvOutput).toContain('david@healthclaim.pro');
    expect(csvOutput).toContain('192.168.1.1');
  });

  it('should support recordLog() executing through AuditTrailTemplate with before/after diff serialization', async () => {
    mockPrismaService.auditLog.create.mockImplementation(({ data }) => Promise.resolve({ id: 'log-diff', ...data }));

    const result = await auditService.recordLog(
      'admin-99',
      'CHANGE_POLICY_LIMIT',
      'POLICY',
      'pol-1',
      { annualLimit: 5000 },
      { annualLimit: 10000 },
      '10.0.0.1',
      'AuditAgent/1.0',
    );

    expect(result).toBeDefined();
    expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-99',
        action: 'CHANGE_POLICY_LIMIT',
        targetResource: 'POLICY',
        targetResourceId: 'pol-1',
        details: {
          diff: {
            before: { annualLimit: 5000 },
            after: { annualLimit: 10000 },
          },
        },
        ipAddress: '10.0.0.1',
        userAgent: 'AuditAgent/1.0',
      },
    });
  });
});

