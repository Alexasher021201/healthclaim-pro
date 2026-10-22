import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { animatePageEntrance } from '../lib/animation';
import {
  User,
  CheckCircle2,
  AlertTriangle,
  Send,
} from 'lucide-react';

export const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const [sendingVerification, setSendingVerification] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const quota = user?.activeQuota;
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    if (containerRef.current) {
      animatePageEntrance(containerRef.current);
    }
  }, []);

  const handleSendVerificationEmail = async () => {
    setSendingVerification(true);
    try {
      const res = await apiClient.post<any, { message: string }>('/auth/send-verification-email');
      toast.success(res.message || 'Verification email sent. Please check your inbox.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send verification email');
    } finally {
      setSendingVerification(false);
    }
  };

  return (
    <div ref={containerRef} className="max-w-4xl mx-auto space-y-6 text-slate-900">
      <div className="anim-header">
        <h2 className="text-xl font-bold tracking-tight text-[#0a2540] flex items-center gap-2">
          <User className="h-5 w-5 text-slate-700" />
          Employee Profile & Benefit Quota
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Personal healthcare plan allocations and account details.
        </p>
      </div>

      {/* Account Info */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 anim-card">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
          Member Credentials
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/60">
            <span className="text-slate-500 font-medium">Full Name</span>
            <p className="font-semibold text-slate-950 text-sm mt-0.5">
              {user?.firstName} {user?.lastName}
            </p>
          </div>
          <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/60">
            <span className="text-slate-500 font-medium">Corporate Email</span>
            <p className="font-semibold text-slate-950 text-sm mt-0.5">{user?.email}</p>
          </div>
          <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/60">
            <span className="text-slate-500 font-medium">Department</span>
            <p className="font-semibold text-slate-950 text-sm mt-0.5">
              {user?.department || 'General Enterprise'}
            </p>
          </div>
          <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/60 flex items-center justify-between">
            <div>
              <span className="text-slate-500 font-medium">Email Verification</span>
              <p className="font-semibold text-slate-950 text-sm mt-0.5 flex items-center gap-1.5">
                {user?.isEmailVerified ? (
                  <span className="text-[#00a88f] flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> Verified
                  </span>
                ) : (
                  <span className="text-slate-600 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> Pending
                  </span>
                )}
              </p>
            </div>
            {!user?.isEmailVerified && (
              <Button
                size="sm"
                onClick={handleSendVerificationEmail}
                disabled={sendingVerification}
                className="gap-1.5"
              >
                <Send className="h-3 w-3" />
                <span>{sendingVerification ? 'Sending...' : 'Send Link'}</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Quota Details */}
      {quota ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-6 anim-card">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <span className="text-xs text-slate-500 font-medium">Fiscal Year {currentYear} Plan</span>
              <h3 className="text-lg font-bold text-[#0a2540] mt-0.5">
                {quota.benefitTier?.name}
              </h3>
            </div>
            <span className="text-xs font-bold px-3 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-[#00a88f]">
              Active
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/60">
              <span className="text-slate-500 font-medium uppercase">Annual Limit</span>
              <p className="text-2xl font-bold text-[#0a2540] mt-1 tracking-tight font-mono">
                ${quota.annualLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/60">
              <span className="text-slate-500 font-medium uppercase">Remaining Balance</span>
              <p className="text-2xl font-bold text-[#0a2540] mt-1 tracking-tight font-mono">
                ${quota.remainingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/60">
              <span className="text-slate-500 font-medium uppercase">Coverage Rate</span>
              <p className="text-2xl font-bold text-[#00a88f] mt-1 tracking-tight font-mono">
                {((quota.benefitTier?.defaultCoPayRate || 0.8) * 100).toFixed(0)}%
              </p>
            </div>
          </div>

          <div className="text-xs text-slate-500 pt-3 border-t border-slate-100 flex items-center justify-between">
            <span>Annual Deductible: ${quota.benefitTier?.defaultDeductible.toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center text-slate-400 text-xs anim-card">
          No medical policy quota assigned for the current fiscal year.
        </div>
      )}
    </div>
  );
};
