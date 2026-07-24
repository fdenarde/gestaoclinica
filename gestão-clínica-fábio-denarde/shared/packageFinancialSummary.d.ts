export interface CanonicalPackageFinancialSummaryInput {
  patient: any;
  sessions?: any[];
  payments?: any[];
  today?: Date | string;
  activatedPackageNumber?: number;
  sessionConsumesPackageFn?: (session: any, options?: { throughDate?: string }) => boolean;
}

export function calculateCanonicalPackageFinancialSummary(
  input: CanonicalPackageFinancialSummaryInput,
): any;

export const CLINIC_PARTNER_SHARE_RATE: number;
export const CLINIC_SESSIONS_PER_PACKAGE: number;
