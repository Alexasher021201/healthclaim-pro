import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import { DepartmentResponseDto } from '@healthclaim/shared';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { toast } from 'sonner';
import {
  Settings,
  User,
  Lock,
  Mail,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Save,
  KeyRound,
  Shield,
} from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const { user, refreshProfile } = useAuth();

  // Profile Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState<DepartmentResponseDto[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);

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

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    refreshProfile();
    const fetchDepartments = async () => {
      try {
        const data = await apiClient.get<any, DepartmentResponseDto[]>('/departments');
        setDepartments(data);
      } catch (err) {
        console.error('Failed to load departments', err);
      }
    };
    fetchDepartments();
  }, [refreshProfile]);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setEmail(user.email || '');
      setDepartment(user.department || '');
    }
  }, [user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast.error('Please provide valid name and email address');
      return;
    }

    setSavingProfile(true);
    try {
      await apiClient.patch('/users/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        department: department.trim() || undefined,
      });

      await refreshProfile();
      toast.success('Account profile updated successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      toast.error('Current password is required');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setSavingPassword(true);
    try {
      await apiClient.patch('/users/me', {
        currentPassword,
        newPassword,
      });

      toast.success('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to change password');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-slate-900">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[#0a2540] flex items-center gap-2">
          <Settings className="h-5 w-5 text-slate-700" />
          Account Settings
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Manage your personal credentials, contact email, department, and security preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Profile Information Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-5">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-[#0a2540] flex items-center gap-2">
                <User className="h-4 w-4 text-slate-600" /> Personal Details
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Update the information you entered during registration
              </p>
            </div>
            <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
              Role: {user?.role}
            </span>
          </div>

          <form onSubmit={handleUpdateProfile} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  First Name
                </label>
                <Input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Last Name
                </label>
                <Input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Corporate Email
                  </label>
                  {user?.isEmailVerified ? (
                    <span className="text-[10px] text-[#00a88f] font-semibold flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Verified
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-amber-600 font-semibold flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Unverified
                      </span>
                      <button
                        type="button"
                        onClick={handleSendVerificationEmail}
                        disabled={sendingVerification}
                        className="text-[10px] text-blue-600 hover:underline font-medium cursor-pointer"
                      >
                        {sendingVerification ? 'Sending...' : 'Send Link'}
                      </button>
                    </div>
                  )}
                </div>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@healthclaim.pro"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Enterprise Department
                </label>
                <Select
                  value={department || undefined}
                  onValueChange={setDepartment}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select corporate department">
                      {department || undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {/* Include user's current custom department if not in standard list */}
                    {department && !departments.some((d) => d.name === department) && (
                      <SelectItem value={department}>
                        <span>{department}</span>
                        <span className="ml-2 text-[10px] text-slate-400 font-mono">(Custom)</span>
                      </SelectItem>
                    )}
                    {departments
                      .filter((d) => d.isActive)
                      .map((dept) => (
                        <SelectItem key={dept.id} value={dept.name}>
                          <span>{dept.name}</span>
                          <span className="ml-2 text-[10px] text-slate-400 font-mono">({dept.code})</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <Button
                type="submit"
                disabled={savingProfile}
                className="gap-2 font-semibold"
              >
                <Save className="h-4 w-4" />
                <span>{savingProfile ? 'Saving Changes...' : 'Save Profile'}</span>
              </Button>
            </div>
          </form>
        </div>

        {/* Security & Password Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-5">
          <div className="pb-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-[#0a2540] flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-slate-600" /> Security & Password
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Change your password to maintain account integrity
            </p>
          </div>

          <form onSubmit={handleUpdatePassword} className="space-y-4 text-xs">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Current Password
              </label>
              <Input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="sm:w-80"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  New Password
                </label>
                <Input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Confirm New Password
                </label>
                <Input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <Button
                type="submit"
                variant="outline"
                disabled={savingPassword}
                className="gap-2 font-semibold"
              >
                <Lock className="h-4 w-4" />
                <span>{savingPassword ? 'Updating...' : 'Update Password'}</span>
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
