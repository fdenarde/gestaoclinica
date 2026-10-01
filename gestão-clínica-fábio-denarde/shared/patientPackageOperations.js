import { calculateCanonicalPackageFinancialSummary, CLINIC_SESSIONS_PER_PACKAGE } from './packageFinancialSummary.js';
import { getPackagePaymentSummary, isPaymentActive, isPaymentReceived } from './packagePayments.js';
import { upsertPackageContractSnapshot, resolvePackageContract } from './packageContract.js';
import { preparePaymentCreation } from './paymentOperations.js';

function requireOperation(patient, operationKey, actor) {
  if (!patient?.id || !String(operationKey || '').trim() || !String(actor || '').trim()) throw new Error('Paciente, operação e responsável são obrigatórios.');
}
export function listPatientPackages({ patient, sessions = [], payments = [], today = new Date() }) {
  const summary = calculateCanonicalPackageFinancialSummary({ patient, sessions, payments, today });
  const numbers = new Set((patient.packageRecords || []).map(item => item.packageNumber));
  for (let n = 1; n <= Math.ceil(summary.consumedSessionTotal / CLINIC_SESSIONS_PER_PACKAGE); n++) numbers.add(n);
  for (const payment of payments) if (payment.patientId === patient.id && payment.packageLinkStatus !== 'unlinked' && isPaymentReceived(payment)) {
    if (Number(payment.packageNumber) > 0) numbers.add(Number(payment.packageNumber));
    else for (let n = 1; n <= summary.paidActivatedPackageNumber; n++) numbers.add(n);
  }
  if (summary.hasCurrentPackage) numbers.add(summary.packageNumber);
  return [...numbers].filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b).map(packageNumber => {
    const record = (patient.packageRecords || []).find(item => item.packageNumber === packageNumber);
    const financial = getPackagePaymentSummary(payments, packageNumber, { patientId: patient.id, packageValueResolver: n => resolvePackageContract(patient, n).contractValue });
    const used = Math.min(CLINIC_SESSIONS_PER_PACKAGE, Math.max(0, summary.consumedSessionTotal - (packageNumber - 1) * CLINIC_SESSIONS_PER_PACKAGE));
    const start = summary.currentPackageSessions.find(item => packageNumber === summary.packageNumber)?.date;
    return { id: record?.id || 'legacy-package-' + packageNumber, packageNumber, total: CLINIC_SESSIONS_PER_PACKAGE, used, remaining: CLINIC_SESSIONS_PER_PACKAGE - used, startDate: record?.startDate || start || '', ...financial,
      label: used === CLINIC_SESSIONS_PER_PACKAGE ? 'Pacote encerrado • Renovação pendente' : financial.isPaid ? 'Pacote ativo • Pago' : 'Pacote ativo • Pagamento pendente' };
  });
}
export function preparePatientPackageCreation({ patient, sessions = [], payments = [], operationKey, actor, contractValue, startDate, now = new Date().toISOString() }) {
  requireOperation(patient, operationKey, actor);
  const existing = (patient.packageRecords || []).find(item => item.operationKey === operationKey);
  if (existing) return { patient, record: existing, idempotent: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) || Number.isNaN(Date.parse(startDate + 'T12:00:00Z')) || new Date(startDate + 'T12:00:00Z').toISOString().slice(0, 10) !== startDate) throw new Error('Informe a data de início do pacote.');
  const known = listPatientPackages({ patient, sessions, payments });
  const last = known.at(-1);
  if (last && last.used < CLINIC_SESSIONS_PER_PACKAGE) throw new Error('O pacote atual ainda possui sessões disponíveis.');
  const packageNumber = (last?.packageNumber || 0) + 1;
  const updated = upsertPackageContractSnapshot(patient, { packageNumber, packageContractValue: contractValue, createdAt: now, createdBy: actor });
  const record = { id: 'package-' + String(operationKey).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120), packageNumber, sessionCount: CLINIC_SESSIONS_PER_PACKAGE, startDate, operationKey, createdAt: now, createdBy: actor };
  return { patient: { ...updated, packageRecords: [...(patient.packageRecords || []), record] }, record, idempotent: false };
}
export function preparePatientPaymentLink({ patient, sessions = [], payments = [], expenses = [], paymentId, packageNumber, operationKey, actor, now = new Date().toISOString() }) {
  requireOperation(patient, operationKey, actor);
  const payment = payments.find(item => item.id === paymentId && item.patientId === patient.id);
  if (!payment || !isPaymentActive(payment)) throw new Error('Escolha um pagamento ativo deste paciente.');
  if (payments.some(item => item.id !== payment.id && (item.packageLinkHistory || []).some(entry => entry.operationKey === operationKey))) throw new Error('A operação já foi usada para outro pagamento.');
  const history = payment.packageLinkHistory || [];
  const previous = history.find(item => item.operationKey === operationKey);
  if (previous) {
    if (previous.packageNumber !== Number(packageNumber)) throw new Error('A operação já foi usada para outro vínculo.');
    return { payments, payment, idempotent: true };
  }
  if (payment.packageLinkStatus !== 'unlinked') throw new Error('Este pagamento já possui vínculo.');
  const candidate = listPatientPackages({ patient, sessions, payments }).find(item => item.packageNumber === Number(packageNumber));
  if (!candidate) throw new Error('Selecione explicitamente um pacote existente deste paciente.');
  // Reuse canonical balance, installment, tolerance and duplication validation; never recreate the receipt or its expense.
  preparePaymentCreation({ patient, sessions, payments: payments.filter(item => item.id !== payment.id), expenses, operationKey: 'validate-link-' + operationKey, actor, now,
    input: { ...payment, packageLinkStatus: 'linked', packageNumber: candidate.packageNumber } });
  const updated = { ...payment, packageNumber: candidate.packageNumber, packageLinkStatus: 'linked', packageLinkHistory: [...history, { packageNumber: candidate.packageNumber, operationKey, linkedAt: now, linkedBy: actor }] };
  return { payments: payments.map(item => item.id === payment.id ? updated : item), payment: updated, idempotent: false };
}
