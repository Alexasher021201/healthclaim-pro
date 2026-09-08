import { PrismaService } from '../../prisma/prisma.service';
import { AuditTrailTemplate } from './audit-trail.template';

/**
 * Concrete implementation of AuditTrailTemplate persisting immutable records into PostgreSQL via Prisma.
 */
export class PrismaAuditTrailTemplate extends AuditTrailTemplate {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  protected async persistRecord(serializedPayload: any): Promise<any> {
    return this.prisma.auditLog.create({
      data: {
        actorId: serializedPayload.actorId,
        action: serializedPayload.action,
        targetResource: serializedPayload.targetResource,
        targetResourceId: serializedPayload.targetResourceId,
        details: serializedPayload.details,
        ipAddress: serializedPayload.ipAddress,
        userAgent: serializedPayload.userAgent,
      },
    });
  }
}
