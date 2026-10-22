import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SubmitClaimPage } from './pages/SubmitClaimPage';
import { MyClaimsPage } from './pages/MyClaimsPage';
import { ClaimAuditQueuePage } from './pages/ClaimAuditQueuePage';
import { UserManagementPage } from './pages/UserManagementPage';
import { BenefitTiersPage } from './pages/BenefitTiersPage';
import { ComplianceRulesPage } from './pages/ComplianceRulesPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { UnauthorizedPage } from './pages/UnauthorizedPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { UserRole } from '@healthclaim/shared';
import { Toaster } from './components/ui/sonner';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/login" element={<LoginPage defaultTab="login" />} />
          <Route path="/register" element={<LoginPage defaultTab="register" />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />

          {/* Protected Application Routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/settings" element={<SettingsPage />} />

              {/* Employee Claim Submission & History */}
              <Route path="/claims/submit" element={<SubmitClaimPage />} />
              <Route path="/claims/my-claims" element={<MyClaimsPage />} />

              {/* Claim Officer & Admin Compliance Engine & Audit Queue */}
              <Route
                element={
                  <ProtectedRoute
                    allowedRoles={[
                      UserRole.CLAIM_OFFICER,
                      UserRole.FINANCE_MANAGER,
                      UserRole.SYSTEM_ADMIN,
                    ]}
                  />
                }
              >
                <Route path="/admin/audit-queue" element={<ClaimAuditQueuePage />} />
                <Route path="/admin/rules" element={<ComplianceRulesPage />} />
              </Route>

              {/* System Admin Specific Routes */}
              <Route element={<ProtectedRoute allowedRoles={[UserRole.SYSTEM_ADMIN]} />}>
                <Route path="/admin/users" element={<UserManagementPage />} />
                <Route path="/admin/policies" element={<BenefitTiersPage />} />
              </Route>

              {/* Security Auditor & Admin Specific Routes */}
              <Route
                element={
                  <ProtectedRoute
                    allowedRoles={[UserRole.SYSTEM_ADMIN, UserRole.SECURITY_AUDITOR]}
                  />
                }
              >
                <Route path="/audit-logs" element={<AuditLogsPage />} />
              </Route>
            </Route>
          </Route>

          {/* Catch-all fallback */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton={false} duration={3000} />
    </AuthProvider>
  );
};
