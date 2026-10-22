import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PoliciesModule } from './policies/policies.module';
import { AuditModule } from './audit/audit.module';
import { RulesModule } from './rules/rules.module';
import { ActuarialModule } from './actuarial/actuarial.module';
import { ClaimsModule } from './claims/claims.module';
import { StorageModule } from './storage/storage.module';
import { DepartmentsModule } from './departments/departments.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './common/mail/mail.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    EventEmitterModule.forRoot(),
    MailModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    PoliciesModule,
    RulesModule,
    ActuarialModule,
    ClaimsModule,
    StorageModule,
    DepartmentsModule,
    AnalyticsModule,
    HealthModule,
  ],
})
export class AppModule {}
