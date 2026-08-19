export const CLINIC_PACKAGE_VALUE: number;

export function isPaymentActive(payment: unknown): boolean;
export function isPaymentReceived(payment: unknown, options?: { throughDate?: string }): boolean;
export function isExpenseActive(expense: unknown): boolean;
export function isExpenseRealized(expense: unknown, options?: { throughDate?: string }): boolean;

export function getPackagePaymentSummary(
  rawPayments: unknown[],
  packageNumber: number,
  options?: {
    patientId?: string;
    packageValue?: number;
    packageValueResolver?: (packageNumber: number) => number;
    throughDate?: string;
  },
): {
  packageNumber: number;
  packageValue: number;
  paidAmount: number;
  pendingAmount: number;
  payments: unknown[];
  installments: unknown[];
  isPaid: boolean;
  financialStatus: 'quitado' | 'pendente';
};

export function getActivatedPackageNumber(
  rawPayments: unknown[],
  options?: {
    patientId?: string;
    packageValue?: number;
    packageValueResolver?: (packageNumber: number) => number;
    allowLegacyFirstPackage?: boolean;
    throughDate?: string;
  },
): number;

export function isPackageActivated(rawPayments: unknown[], packageNumber: number, options?: Parameters<typeof getActivatedPackageNumber>[1]): boolean;
