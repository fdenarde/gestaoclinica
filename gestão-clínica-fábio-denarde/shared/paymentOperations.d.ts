export interface PaymentCreationInput {
  patient: any;
  sessions?: any[];
  payments?: any[];
  expenses?: any[];
  input: {
    patientId: string;
    packageNumber: number;
    amount: number;
    date: string;
    installment: string;
    method: string;
  };
  operationKey: string;
  actor: string;
  now?: string;
}

export interface PaymentVoidInput {
  payments?: any[];
  expenses?: any[];
  paymentId: string;
  reason: string;
  actor: string;
  now?: string;
}

export function createPaymentOperationKey(): string;
export function preparePaymentCreation(input: PaymentCreationInput): {
  payment: any;
  expense: any;
  payments: any[];
  expenses: any[];
  idempotent: boolean;
};
export function preparePaymentVoid(input: PaymentVoidInput): {
  payment: any;
  payments: any[];
  expenses: any[];
  idempotent: boolean;
};
