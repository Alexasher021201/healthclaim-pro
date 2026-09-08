/**
 * Audit event execution context
 */
export interface AuditContext<T = any> {
  actorId?: string;
  action: string;
  targetResource: string;
  targetResourceId?: string;
  oldValues?: any;
  newValues?: any;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
  metadata?: T;
}

/**
 * GoF Template Method Pattern:
 * Defines the invariant auditing workflow template with immutable sequence of steps:
 * 1. extractContext: enrich and sanitize network/actor metadata
 * 2. validatePermissions: ensure audit event meets compliance requirements
 * 3. serializeDiffs: compute and structure state transitions / diffs
 * 4. persistRecord: abstract step delegated to concrete persistence subclasses
 */
export abstract class AuditTrailTemplate<T = any, R = any> {
  /**
   * The Template Method governing the audit recording lifecycle
   */
  async execute(context: AuditContext<T>): Promise<R> {
    const enrichedContext = await this.extractContext(context);
    this.validatePermissions(enrichedContext);
    const serializedPayload = this.serializeDiffs(enrichedContext);
    return await this.persistRecord(serializedPayload);
  }

  /**
   * Invariant step: Normalizes IP, User-Agent, and actor context
   */
  protected async extractContext(context: AuditContext<T>): Promise<AuditContext<T>> {
    return {
      ...context,
      ipAddress: context.ipAddress?.trim() || '127.0.0.1',
      userAgent: context.userAgent?.trim() || 'Internal System Kernel',
    };
  }

  /**
   * Invariant step: Validates minimum mandatory compliance audit attributes
   */
  protected validatePermissions(context: AuditContext<T>): void {
    if (!context.action || !context.action.trim()) {
      throw new Error('Audit compliance violation: audit action cannot be empty.');
    }
    if (!context.targetResource || !context.targetResource.trim()) {
      throw new Error('Audit compliance violation: targetResource cannot be empty.');
    }
  }

  /**
   * Invariant step: Formats before-and-after change diffs into audit detail payload
   */
  protected serializeDiffs(context: AuditContext<T>): any {
    let details = context.details;

    if (context.oldValues !== undefined || context.newValues !== undefined) {
      details = {
        ...(details || {}),
        diff: {
          before: context.oldValues ?? null,
          after: context.newValues ?? null,
        },
      };
    }

    return {
      actorId: context.actorId,
      action: context.action,
      targetResource: context.targetResource,
      targetResourceId: context.targetResourceId,
      details,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    };
  }

  /**
   * Primitive hook method: delegated to concrete subclasses (e.g. Prisma DB writer)
   */
  protected abstract persistRecord(serializedPayload: any): Promise<R>;
}
