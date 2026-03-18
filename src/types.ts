import { Timestamp } from 'firebase/firestore';

export type VaultItemType = 'email' | 'whatsapp' | 'finance' | 'plan' | 'log' | 'handbook' | 'dashboard';
export type VaultItemStatus = 'pending' | 'in_progress' | 'done' | 'approved' | 'rejected';
export type PriorityLevel = 'low' | 'medium' | 'high' | 'urgent';

export interface VaultItem {
  id?: string;
  title: string;
  content: string;
  path: string;
  type: VaultItemType;
  status: VaultItemStatus;
  priority?: PriorityLevel;
  dependencies?: string[];
  metadata?: Record<string, any>;
  uid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  businessGoals?: string;
  rulesOfEngagement?: string;
  theme?: 'light' | 'dark';
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}
