import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailTemplate, AuditContext } from './templates/audit-trail.template';
import { PrismaAuditTrailTemplate } from './templates/prisma-audit-trail.template';

export { AuditTrailTemplate, AuditContext, PrismaAuditTrailTemplate };

@Injectable()
export class AuditService {
  private readonly auditTemplate: PrismaAuditTrailTemplate;

  constructor(private readonly prisma: PrismaService) {
    this.auditTemplate = new PrismaAuditTrailTemplate(this.prisma);
  }

  /**
   * Record structured audit log via GoF Template Method pattern
   */
  async log(entry: {
    actorId?: string;
    action: string;
    targetResource: string;
    targetResourceId?: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.auditTemplate.execute(entry);
  }

  /**
   * Academic OOAD method specification:
   * recordLog(userId, action, resourceType, resourceId, oldValues, newValues, ipAddress, userAgent)
   */
  async recordLog(
    userId?: string,
    action: string = 'UNKNOWN',
    resourceType: string = 'SYSTEM',
    resourceId?: string,
    oldValues?: any,
    newValues?: any,
    ipAddress?: string,
    userAgent?: string,
  ) {
    return this.auditTemplate.execute({
      actorId: userId,
      action,
      targetResource: resourceType,
      targetResourceId: resourceId,
      oldValues,
      newValues,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Retrieve audit logs with filters (Auditor & Admin)
   */
  async getAuditLogs(params?: {
    action?: string;
    actorId?: string;
    targetResource?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 50;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (params?.action) where.action = params.action;
    if (params?.actorId) where.actorId = params.actorId;
    if (params?.targetResource) where.targetResource = params.targetResource;

    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Generate CSV format for audit log export
   */
  async exportAuditLogsCsv(action?: string): Promise<string> {
    const where: any = {};
    if (action && action !== 'ALL') where.action = action;

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    const headers = [
      'Timestamp (ISO)',
      'Event Action',
      'Actor Name',
      'Actor Email',
      'Actor Role',
      'Target Resource',
      'Target Resource ID',
      'IP Origin',
      'Details Snapshot',
    ];

    const escapeCsv = (str: string | undefined | null) => {
      if (str === undefined || str === null) return '""';
      const clean = String(str).replace(/"/g, '""');
      return `"${clean}"`;
    };

    const rows = logs.map((log) => [
      escapeCsv(log.createdAt.toISOString()),
      escapeCsv(log.action),
      escapeCsv(log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : 'System Kernel'),
      escapeCsv(log.actor?.email || 'system'),
      escapeCsv(log.actor?.role || 'SYSTEM'),
      escapeCsv(log.targetResource),
      escapeCsv(log.targetResourceId || 'N/A'),
      escapeCsv(log.ipAddress || '127.0.0.1'),
      escapeCsv(log.details ? JSON.stringify(log.details) : ''),
    ]);

    // Prepend UTF-8 BOM (\uFEFF) so Excel opens multilingual CSV flawlessly
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

    return csvContent;
  }
}

export { AuditService as AuditLogService };

