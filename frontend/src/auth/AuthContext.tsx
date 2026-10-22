import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserRole, LoginRequest, RegisterRequest } from '@healthclaim/shared';
import { apiClient } from '../api/client';

export interface UserProfileWithQuota {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  department?: string | null;
  isEmailVerified: boolean;
  activeQuota?: {
    id: string;
    fiscalYear: number;
    annualLimit: number;
    remainingBalance: number;
    cumulativeDeductibleSpent: number;
    benefitTier: {
      id: string;
      name: string;
      code: string;
      annualLimit: number;
      defaultDeductible: number;
      defaultCoPayRate: number;
    };
  } | null;
}

interface AuthContextType {
  user: UserProfileWithQuota | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfileWithQuota | null>(() => {
    try {
      const saved = localStorage.getItem('healthclaim_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      localStorage.removeItem('healthclaim_user');
      return null;
    }
  });

  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('healthclaim_token');
    } catch {
      return null;
    }
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshProfile = useCallback(async () => {
    const currentToken = localStorage.getItem('healthclaim_token');
    if (!currentToken) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const profile = await apiClient.get<any, UserProfileWithQuota>('/users/me');
      setUser(profile);
      localStorage.setItem('healthclaim_user', JSON.stringify(profile));
    } catch (error) {
      console.warn('Failed to refresh user profile:', error);
      setUser(null);
      setToken(null);
      localStorage.removeItem('healthclaim_token');
      localStorage.removeItem('healthclaim_user');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      refreshProfile();
    } else {
      setIsLoading(false);
    }
  }, [token, refreshProfile]);

  const login = async (credentials: LoginRequest) => {
    setIsLoading(true);
    try {
      const response = await apiClient.post<any, { accessToken: string; user: any }>(
        '/auth/login',
        credentials,
      );
      const authToken = response.accessToken;
      localStorage.setItem('healthclaim_token', authToken);
      setToken(authToken);
      await refreshProfile();
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (data: RegisterRequest) => {
    setIsLoading(true);
    try {
      await apiClient.post<any, { accessToken: string; user: any }>(
        '/auth/register',
        data,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('healthclaim_token');
    localStorage.removeItem('healthclaim_user');
    setToken(null);
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token && !!user,
        isLoading,
        login,
        register,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
