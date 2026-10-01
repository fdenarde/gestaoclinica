import React, { useMemo, useRef, useState } from 'react';
import { AppState, Patient, Payment } from '../../types';
import Modal from './Modal';
import { showToast } from './Toast';
import { SESSIONS_PER_PACKAGE } from '../../lib/financePackages';
import { formatCurrency, safeFormatDate } from '../../lib/utils';
import { createPaymentOperationKey, preparePaymentCreation } from '../../../shared/paymentOperations.js';
import { isPaymentActive } from '../../../shared/packagePayments.js';
import { listPatientPackages, preparePatientPackageCreation, preparePatientPaymentLink } from '../../../shared/patientPackageOperations.js';
import { endPackageToleranceAfterPayment } from '../../lib/packageTolerance';

type Action = 'package' | 'payment' | 'link';
interface Props { key?: string; patient: Patient; state: AppState; onUpdate: (update: Partial<AppState>) => boolean | void | Promise<boolean | void>; actor: string; initialAction?: Action; compact?: boolean; onBusyChange?: (busy: boolean) => void; }
export default function PatientPackagesPayments({ patient, state, onUpdate, actor, initialAction, compact = false, onBusyChange }: Props) {
  const [action, setAction] = useState<Action | null>(initialAction || null);
  const [operationKey, setOperationKey] = useState(() => initialAction ? createPaymentOperationKey() : '');
  const [saving, setSaving] = useState(false);
  const writeLock = useRef(false);
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [amount, setAmount] = useState('');
  const [packageChoice, setPackageChoice] = useState('');
  const [paymentChoice, setPaymentChoice] = useState('');
  const [method, setMethod] = useState<Payment['method']>('Pix');
  const [installment, setInstallment] = useState<Payment['installment']>('Pagamento integral');
  const packages = useMemo(() => listPatientPackages({ patient, sessions: state.sessions, payments: state.payments }), [patient, state.sessions, state.payments]);
  const current = packages.at(-1);
  const receipts = useMemo(() => state.payments.filter(item => item.patientId === patient.id).slice().sort((a, b) => b.date.localeCompare(a.date)), [state.payments, patient.id]);
  const unlinked = receipts.filter(item => isPaymentActive(item) && item.packageLinkStatus === 'unlinked');
  const lastPayment = receipts.find(isPaymentActive);
  const open = (next: Action) => {
    if (writeLock.current) return;
    setAction(next); setOperationKey(createPaymentOperationKey()); setAmount(''); setPackageChoice(''); setPaymentChoice('');
  };
  const close = () => { if (!writeLock.current) setAction(null); };
  const save = async () => {
    if (!action || writeLock.current) return;
    writeLock.current = true; setSaving(true); onBusyChange?.(true);
    try {
      let updatedPatient = patient;
      let updatedPayments = state.payments;
      let updatedExpenses = state.expenses;
      if (action === 'package') {
        const result = preparePatientPackageCreation({ patient, sessions: state.sessions, payments: state.payments, operationKey, actor, contractValue: Number(amount), startDate: date });
        updatedPatient = result.patient;
        if (paymentChoice) updatedPayments = preparePatientPaymentLink({ patient: updatedPatient, sessions: state.sessions, payments: state.payments, expenses: state.expenses, paymentId: paymentChoice, packageNumber: result.record.packageNumber, operationKey: operationKey + '-link', actor }).payments;
      } else if (action === 'payment') {
        if (!packageChoice) throw new Error('Escolha um pacote ou Registrar sem vincular agora.');
        if (packageChoice !== 'unlinked' && !packages.some(item => item.packageNumber === Number(packageChoice))) throw new Error('Escolha um pacote existente deste paciente.');
        const result = preparePaymentCreation({ patient, sessions: state.sessions, payments: state.payments, expenses: state.expenses, operationKey, actor,
          input: { patientId: patient.id, amount: Number(amount), date, method, installment, ...(packageChoice === 'unlinked' ? { packageLinkStatus: 'unlinked' } : { packageNumber: Number(packageChoice) }) } });
        updatedPayments = result.payments; updatedExpenses = result.expenses;
        if (packageChoice !== 'unlinked') updatedPatient = endPackageToleranceAfterPayment(patient, { packageNumber: Number(packageChoice), actor });
      } else {
        if (!paymentChoice || !packageChoice) throw new Error('Escolha explicitamente o pagamento e o pacote.');
        const result = preparePatientPaymentLink({ patient, sessions: state.sessions, payments: state.payments, expenses: state.expenses, paymentId: paymentChoice, packageNumber: Number(packageChoice), operationKey, actor });
        updatedPayments = result.payments;
        updatedPatient = endPackageToleranceAfterPayment(patient, { packageNumber: Number(packageChoice), actor });
      }
      const update: Partial<AppState> = {};
      if (updatedPatient !== patient) update.patients = state.patients.map(item => item.id === patient.id ? updatedPatient : item);
      if (updatedPayments !== state.payments) update.payments = updatedPayments;
      if (updatedExpenses !== state.expenses) update.expenses = updatedExpenses;
      if (Object.keys(update).length && await onUpdate(update) !== true) throw new Error('Não foi possível confirmar a gravação. Tente novamente.');
      showToast(action === 'package' ? 'Pacote registrado com sucesso.' : action === 'link' ? 'Vínculo confirmado.' : 'Pagamento registrado com sucesso.', 'success');
      setAction(null);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Não foi possível concluir a operação.', 'error'); }
    finally { writeLock.current = false; setSaving(false); onBusyChange?.(false); }
  };
  const control = 'w-full rounded-lg border border-clinic-border bg-white p-2 text-sm';
  return <section aria-label="Pacotes e pagamentos" className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-clinic-border p-4"><h3 className="font-bold">Pacote atual</h3>
        {current ? <><p className="mt-1 font-semibold">{current.label}</p><p>Pacote {current.packageNumber} • {current.used}/{current.total} utilizadas • {current.remaining} restantes</p>{current.startDate && <p>Início: {safeFormatDate(current.startDate, 'dd/MM/yyyy')}</p>}{!current.payments.length && <p>Pacote ativo — pagamento ainda não registrado</p>}</> : <p>{unlinked.length ? 'Pagamento recebido — pacote ainda não criado' : 'Nenhum pacote registrado'}</p>}
      </div>
      <div className="rounded-xl border border-clinic-border p-4"><h3 className="font-bold">Financeiro relacionado</h3>
        {lastPayment ? <><p>Último pagamento: {formatCurrency(lastPayment.amount)} • {safeFormatDate(lastPayment.date, 'dd/MM/yyyy')}</p><p>{lastPayment.packageLinkStatus === 'unlinked' ? 'Pagamento não vinculado' : 'Vinculado ao pacote ' + (lastPayment.packageNumber || 'legado')}</p></> : <p>Nenhum pagamento registrado</p>}
        {!!unlinked.length && <p>{unlinked.length} pagamento(s) sem vínculo</p>}
      </div>
    </div>
    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => open('package')} className="rounded-lg bg-clinic-primary px-3 py-2 text-sm font-bold text-white">+ Novo pacote</button><button type="button" onClick={() => open('payment')} className="rounded-lg border border-clinic-primary px-3 py-2 text-sm font-bold text-clinic-primary">+ Registrar pagamento</button>{!!unlinked.length && !!packages.length && <button type="button" onClick={() => open('link')} className="rounded-lg border border-clinic-border px-3 py-2 text-sm">Vincular pagamento</button>}</div>
    {!compact && <details className="rounded-xl border border-clinic-border p-3"><summary className="cursor-pointer font-bold">Histórico de pacotes, pagamentos e vínculos</summary><div className="mt-3 space-y-2 text-sm">{packages.map(item => <p key={item.id}>Pacote {item.packageNumber} • {item.used}/{item.total} • {item.label} • {formatCurrency(item.paidAmount)} recebido</p>)}{receipts.map(item => <div key={item.id}><p>{safeFormatDate(item.date, 'dd/MM/yyyy')} • {formatCurrency(item.amount)} • {item.status === 'voided' ? 'Cancelado' : item.packageLinkStatus === 'unlinked' ? 'Pagamento não vinculado' : 'Pacote ' + (item.packageNumber || 'legado')}</p>{item.packageLinkHistory?.map(link => <p key={link.operationKey}>Vínculo confirmado: Pacote {link.packageNumber} • {safeFormatDate(link.linkedAt, 'dd/MM/yyyy')}</p>)}</div>)}</div></details>}
    <section hidden={!action} aria-label="Formulário de pacote e pagamento" className="rounded-xl border border-clinic-border bg-clinic-bg/40 p-4">
      <h4 className="mb-3 font-bold">{action === 'package' ? 'Novo pacote' : action === 'link' ? 'Vincular pagamento ao pacote' : 'Registrar pagamento'}</h4>
      <div className="space-y-3"><p className="text-sm">{patient.name}</p><fieldset disabled={saving} className="space-y-3">
        {action !== 'link' && <><label className="block">{action === 'package' ? 'Data de início' : 'Data do pagamento'}<input aria-label={action === 'package' ? 'Data de início' : 'Data do pagamento'} type="date" value={date} onChange={event => setDate(event.target.value)} className={control} /></label><label className="block">{action === 'package' ? 'Valor contratado' : 'Valor recebido'}<input aria-label={action === 'package' ? 'Valor contratado' : 'Valor recebido'} type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className={control} /></label></>}
        {action === 'package' && <><p>Quantidade: {current?.total || SESSIONS_PER_PACKAGE} sessões. A duração não multiplica a quantidade.</p><label className="block">Pagamento anterior sem vínculo (opcional)<select aria-label="Pagamento anterior sem vínculo" value={paymentChoice} onChange={event => setPaymentChoice(event.target.value)} className={control}><option value="">Não vincular</option>{unlinked.map(item => <option key={item.id} value={item.id}>{safeFormatDate(item.date, 'dd/MM/yyyy')} • {formatCurrency(item.amount)}</option>)}</select></label></>}
        {action === 'payment' && <><label className="block">Forma de pagamento<select aria-label="Forma de pagamento" value={method} onChange={event => setMethod(event.target.value as Payment['method'])} className={control}>{(['Pix', 'Dinheiro', 'Transferência', 'Outro'] as const).map(value => <option key={value}>{value}</option>)}</select></label><label className="block">Parcela<select aria-label="Parcela" value={installment} onChange={event => setInstallment(event.target.value as Payment['installment'])} className={control}>{(['Pagamento integral', '1ª parcela', '2ª parcela'] as const).map(value => <option key={value}>{value}</option>)}</select></label></>}
        {action === 'link' && <label className="block">Pagamento<select aria-label="Pagamento sem vínculo" value={paymentChoice} onChange={event => setPaymentChoice(event.target.value)} className={control}><option value="">Selecione explicitamente</option>{unlinked.map(item => <option key={item.id} value={item.id}>{safeFormatDate(item.date, 'dd/MM/yyyy')} • {formatCurrency(item.amount)}</option>)}</select></label>}
        {action !== 'package' && <label className="block">Vincular este pagamento ao pacote?<select aria-label="Vínculo do pagamento" value={packageChoice} onChange={event => setPackageChoice(event.target.value)} className={control}><option value="">Selecione explicitamente</option>{action === 'payment' && <option value="unlinked">Registrar sem vincular agora</option>}{packages.map(item => <option key={item.id} value={item.packageNumber}>Vincular ao pacote {item.packageNumber} • saldo {formatCurrency(item.pendingAmount)}</option>)}</select></label>}
      </fieldset><div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={close}>Cancelar</button><button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-clinic-primary px-4 py-2 font-bold text-white">{saving ? 'Salvando...' : 'Confirmar'}</button></div></div>
    </section>
  </section>;
}

export function PatientPackagesPaymentsDialog({ patientId, state, onUpdate, actor, action, onClose }: { patientId: string | null; state: AppState; onUpdate: Props['onUpdate']; actor: string; action?: Action; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const patient = state.patients.find(item => item.id === patientId);
  return patient ? <Modal isOpen={true} closeDisabled={busy} onClose={onClose} title="Pacotes e pagamentos" width="max-w-3xl"><PatientPackagesPayments key={patient.id} patient={patient} state={state} onUpdate={onUpdate} actor={actor} initialAction={action} onBusyChange={setBusy} /></Modal> : null;
}
