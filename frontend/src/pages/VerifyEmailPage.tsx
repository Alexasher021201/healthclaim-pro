import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CheckCircle2, XCircle, Loader2, ArrowRight } from 'lucide-react';
import { BRAND_CONFIG } from '../config/branding';

export const VerifyEmailPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const hasToken = !!localStorage.getItem('healthclaim_token');
    setIsLoggedIn(hasToken);

    if (!token) {
      setStatus('error');
      setMessage('Missing or invalid verification token.');
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const verify = async () => {
      try {
        const res = await apiClient.get<any, { message: string }>(`/auth/verify-email?token=${token}`);
        setStatus('success');
        setMessage(res.message || 'Your email address has been successfully verified.');

        // Update local storage user profile if user is currently authenticated
        const savedUserStr = localStorage.getItem('healthclaim_user');
        if (savedUserStr) {
          try {
            const savedUser = JSON.parse(savedUserStr);
            savedUser.isEmailVerified = true;
            localStorage.setItem('healthclaim_user', JSON.stringify(savedUser));
          } catch {
            // Ignore parse errors
          }
        }

        if (hasToken) {
          try {
            await refreshProfile();
          } catch {
            // Non-blocking
          }
          // Auto-redirect to dashboard for authenticated users after 2 seconds
          timer = setTimeout(() => {
            navigate('/dashboard');
          }, 2000);
        } else {
          // Auto-redirect to login for unauthenticated users after 3 seconds
          timer = setTimeout(() => {
            navigate('/login');
          }, 3000);
        }
      } catch (err: any) {
        setStatus('error');
        setMessage(err.message || 'Verification link is invalid or has expired.');
      }
    };

    verify();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [token, navigate, refreshProfile]);

  return (
    <div className="min-h-screen bg-slate-50/70 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-[420px]">
        <div className="flex flex-col items-center justify-center mb-6 text-center">
          <img
            src={BRAND_CONFIG.logoUrl}
            alt={BRAND_CONFIG.fullName}
            className="h-14 w-auto object-contain"
          />
        </div>

        <div className="bg-white p-8 border border-slate-200/80 rounded-2xl shadow-sm text-center">
          {status === 'loading' && (
            <div className="py-8 flex flex-col items-center">
              <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
              <h2 className="text-base font-bold text-slate-800">Verifying Email...</h2>
              <p className="text-xs text-slate-500 mt-1">Please wait while we validate your activation token.</p>
            </div>
          )}

          {status === 'success' && (
            <div className="py-6 flex flex-col items-center">
              <div className="h-14 w-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Email Verified!</h2>
              <p className="text-xs text-slate-600 mt-2 max-w-xs">{message}</p>
              <p className="text-[11px] text-slate-400 mt-1 mb-4">
                {isLoggedIn
                  ? 'You are already signed in. Redirecting to your dashboard in 2s...'
                  : 'Redirecting to sign in in 3s...'}
              </p>
              <button
                onClick={() => navigate(isLoggedIn ? '/dashboard' : '/login')}
                className="w-full py-2.5 px-4 bg-[#0a2540] hover:bg-[#081e35] text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition"
              >
                <span>{isLoggedIn ? 'Go to Dashboard' : 'Continue to Sign In'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="py-6 flex flex-col items-center">
              <div className="h-14 w-14 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
                <XCircle className="h-8 w-8" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Verification Failed</h2>
              <p className="text-xs text-rose-600 mt-2 max-w-xs">{message}</p>
              <Link
                to="/login"
                className="mt-6 inline-block text-xs font-bold text-[#0a2540] hover:underline"
              >
                Back to Sign In
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
