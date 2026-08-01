export type PackageToleranceReasonCode =
  | 'requested_days'
  | 'forgot_payment'
  | 'temporary_financial_difficulty'
  | 'payment_not_identified'
  | 'other';

export interface PackageToleranceRecord {
  id: string;
  version: 1;
  packageNumber: number;
  status: 'active' | 'closed';
  reasonCode: PackageToleranceReasonCode;
  reasonText?: string;
  notes?: string;
  promisedPaymentDate: string;
  expiresAt: string;
  maxSessions: number;
  authorizedAt: string;
  authorizedBy: string;
  updatedAt: string;
  updatedBy: string;
  closedAt?: string;
  closedBy?: string;
  closeReason?: string;
  supersedesId?: string;
}

export type PackageToleranceResolutionStatus =
  | 'none'
  | 'active'
  | 'expired'
  | 'limit_reached'
  | 'paid'
  | 'closed';

export interface PackageToleranceResolution {
  record: PackageToleranceRecord | null;
  packageNumber: number;
  patientId: string;
  today: string;
  paidActivatedPackageNumber: number;
  sessionsUsed: number;
  remainingSessions: number;
  daysRemaining: number | null;
  status: PackageToleranceResolutionStatus;
  isActive: boolean;
  isExpired: boolean;
  isPaid: boolean;
  canReceiveNewSessions: boolean;
  keepsHistoricalAccess: boolean;
}

export interface PackageToleranceAlert {
  id: string;
  patientId: string;
  patientName: string;
  guardianName: string;
  packageNumber: number;
  status: 'active' | 'expires_today' | 'expiring' | 'expired' | 'limit_reached';
  expiresAt: string;
  promisedPaymentDate: string;
  maxSessions: number;
  sessionsUsed: number;
  remainingSessions: number;
  daysRemaining: number | null;
  reasonLabel: string;
}
