import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Banknote, CalendarDays, Check, CircleDollarSign, Plus, Receipt, RotateCcw, Search, WalletCards, X } from 'lucide-react';
import type { PsychologyPatient, PsychologyStore } from './psychologyDomain';
import {
  cancelPsychologyCharge,
  createPsychologyChargeInLedger,
  createPsychologyExpenseInLedger,
  createPsychologyPaymentInLedger,
  createPsychologyPeriod,
  getPsychologyFinancialLedger,
  getPsychologyFinancialOverview,
  isPsychologyPaymentActive,
  psychologyCivilDate,
  reversePsychologyExpense,
  reversePsychologyPayment,
  type PsychologyLedgerMutation,
  type PsychologyCanonicalChargeStatus,
  type PsychologyExpenseInput,
  type PsychologyFinancialPeriod,
  type PsychologyPeriodPreset,
} from './psychologyFinancialLedger';
import type { PsychologyExpenseCategory, PsychologyExpenseStatus, PsychologyPaymentMethod } from './psychologyR2a';
import { formatPsychologyMoney } from './psychologyPatientProfile';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const categories: PsychologyExpenseCategory[] = ['Aluguel', 'Materiais', 'Serviços', 'Impostos/Taxas', 'Marketing', 'Capacitação', 'Tecnologia', 'Outros'];
const paymentMethods: Array<{ value: PsychologyPaymentMethod; label: string }> = [{ value: 'PIX', label: 'Pix' }, { value: 'CASH', label: 'Dinheiro' }, { value: 'CARD', label: 'Cartão' }, { value: 'TRANSFER', label: 'Transferência' }, { value: 'OTHER', label: 'Outro' }];

type FinanceTab = 'overview' | 'charges' | 'payments' | 'expenses';
type Modal = 'charge' | 'payment' | 'expense' | null;
type ReasonRequest = { type: 'charge' | 'payment' | 'expense'; id: string };

function dateLabel(value?: string): string {
  if (!value) return 'Sem vencimento';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function chargeStatusLabel(status: PsychologyCanonicalChargeStatus, overdue = false): string {
  if (status === 'CANCELLED') return 'Cancelada';
  if (status === 'EXEMPT') return 'Isento / cortesia';
  if (overdue) return 'Vencida';
  if (status === 'PAID') return 'Paga';
  if (status === 'PARTIALLY_PAID') return 'Parcialmente paga';
  return 'Pendente';
}

function statusClass(status: PsychologyCanonicalChargeStatus, overdue = false): string {
  if (status === 'CANCELLED') return 'bg-slate-100 text-slate-600';
  if (status === 'EXEMPT') return 'bg-violet-50 text-violet-700';
  if (overdue) return 'bg-rose-50 text-rose-700';
  if (status === 'PAID') return 'bg-emerald-50 text-emerald-700';
  if (status === 'PARTIALLY_PAID') return 'bg-amber-50 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-black text-slate-600">{label}</span>{children}</label>;
}

function FinanceDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true"><section className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-black text-slate-900">{title}</h2><button type="button" onClick={onClose} aria-label="Fechar" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></header><div className="space-y-4 p-5">{children}</div></section></div>;
}

function OverviewCard({ label, value, tone }: { label: string; value: string; tone: 'violet' | 'emerald' | 'amber' | 'rose' | 'slate' }) {
  const tones = { violet: 'border-violet-200 bg-violet-50/70', emerald: 'border-emerald-200 bg-emerald-50/70', amber: 'border-amber-200 bg-amber-50/70', rose: 'border-rose-200 bg-rose-50/70', slate: 'border-slate-200 bg-white' };
  return <article className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}><p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p></article>;
}

export default function PsychologyFinanceView({ store, onStoreChange, onNotice, onRemoteMutation, remoteWriteBlocked = false }: { store: PsychologyStore; onStoreChange: (store: PsychologyStore) => boolean; onNotice: (message: string) => void; onRemoteMutation?: (mutation: PsychologyLedgerMutation) => boolean | Promise<boolean>; remoteWriteBlocked?: boolean }) {
  const [tab, setTab] = useState<FinanceTab>('overview');
  const [modal, setModal] = useState<Modal>(null);
  const [reasonRequest, setReasonRequest] = useState<ReasonRequest | null>(null);
  const [reason, setReason] = useState('');
  const [preset, setPreset] = useState<PsychologyPeriodPreset>('month');
  const [customStart, setCustomStart] = useState(psychologyCivilDate());
  const [customEnd, setCustomEnd] = useState(psychologyCivilDate());
  const [search, setSearch] = useState('');
  const [chargeFilter, setChargeFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [expenseFilter, setExpenseFilter] = useState('all');
  const [processing, setProcessing] = useState(false);
  const mutationLock = useRef(false);
  const period = useMemo<PsychologyFinancialPeriod>(() => createPsychologyPeriod(preset, new Date(), customStart, customEnd), [customEnd, customStart, preset]);
  const ledger = useMemo(() => getPsychologyFinancialLedger(store), [store]);
  const overview = useMemo(() => getPsychologyFinancialOverview(store, period), [period, store]);
  const patientMap = useMemo(() => new Map<string | null, PsychologyPatient>(store.patients.map(patient => [patient.id, patient] as [string | null, PsychologyPatient])), [store.patients]);
  const charges = useMemo(() => ledger.chargeEntries.filter(entry => {
    const patient = entry.charge.patientId ? patientMap.get(entry.charge.patientId)?.name || '' : 'Paciente excluído';
    const matchesSearch = !search.trim() || `${patient} ${entry.charge.description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    const matchesFilter = chargeFilter === 'all' || (chargeFilter === 'overdue' ? entry.overdue : chargeFilter === entry.status.toLowerCase());
    return matchesSearch && matchesFilter;
  }), [chargeFilter, ledger.chargeEntries, patientMap, search]);
  const payments = useMemo(() => ledger.payments.filter(payment => {
    const patient = payment.patientId ? patientMap.get(payment.patientId)?.name || '' : 'Paciente excluído';
    const charge = ledger.charges.find(item => item.id === payment.chargeId);
    const matchesSearch = !search.trim() || `${patient} ${charge?.description || ''} ${payment.method}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    const matchesFilter = paymentFilter === 'all' || (paymentFilter === 'active' ? isPsychologyPaymentActive(payment) : !isPsychologyPaymentActive(payment));
    return matchesSearch && matchesFilter;
  }), [ledger.charges, ledger.payments, patientMap, paymentFilter, search]);
  const expenses = useMemo(() => ledger.expenses.filter(expense => {
    const matchesSearch = !search.trim() || `${expense.description} ${expense.category} ${expense.status}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    const matchesFilter = expenseFilter === 'all' || expense.status === expenseFilter;
    return matchesSearch && matchesFilter;
  }), [expenseFilter, ledger.expenses, search]);

  const saveMutation = (result: PsychologyLedgerMutation, success: string, onSuccess?: () => void): boolean | Promise<boolean> => {
    if (result.error) { onNotice(result.error); return false; }
    if (remoteWriteBlocked) {
      onNotice('Aguarde o carregamento do provider remoto antes de salvar o financeiro.');
      return false;
    }
    if (processing || mutationLock.current) return false;
    const finish = (saved: boolean): boolean => {
      setProcessing(false);
      mutationLock.current = false;
      if (!saved) {
        onNotice('Nenhuma alteração financeira foi confirmada.');
        return false;
      }
      onNotice(success);
      setModal(null);
      onSuccess?.();
      return true;
    };
    if (onRemoteMutation) {
      mutationLock.current = true;
      setProcessing(true);
      try {
        const saved = onRemoteMutation(result);
        return saved instanceof Promise ? saved.then(finish).catch(() => finish(false)) : finish(saved);
      } catch {
        return finish(false);
      }
    }
    return finish(onStoreChange(result.store));
  };

  const confirmReason = () => {
    if (!reason.trim() || !reasonRequest) return;
    const result = reasonRequest.type === 'charge'
      ? cancelPsychologyCharge(store, reasonRequest.id, reason)
      : reasonRequest.type === 'payment'
        ? reversePsychologyPayment(store, reasonRequest.id, reason)
        : reversePsychologyExpense(store, reasonRequest.id, reason);
    const success = reasonRequest.type === 'charge' ? 'Cobrança cancelada.' : reasonRequest.type === 'payment' ? 'Pagamento estornado.' : 'Despesa estornada.';
    void Promise.resolve(saveMutation(result, success, () => { setReasonRequest(null); setReason(''); }));
  };

  return <div className="space-y-5" data-testid="psychology-finance" aria-busy={processing}><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Financeiro administrativo</p><h3 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Acompanhe recebimentos, pendências e despesas.</h3><p className="mt-2 text-sm text-slate-500">Visão financeira da Psicologia · caixa por data de recebimento e realização.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setModal('charge')} disabled={remoteWriteBlocked || processing} title={remoteWriteBlocked ? 'Aguarde o carregamento financeiro' : undefined} className={primaryButton}><Plus size={16} /> Nova cobrança</button><button type="button" onClick={() => setModal('payment')} disabled={remoteWriteBlocked || processing} title={remoteWriteBlocked ? 'Aguarde o carregamento financeiro' : undefined} className={secondaryButton}><WalletCards size={16} /> Registrar pagamento</button><button type="button" onClick={() => setModal('expense')} disabled={remoteWriteBlocked || processing} title={remoteWriteBlocked ? 'Aguarde o carregamento financeiro' : undefined} className={secondaryButton}><Banknote size={16} /> Nova despesa</button></div></div>{remoteWriteBlocked && <div role="status" data-testid="psychology-finance-remote-readonly" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">Provider remoto ativo: carregando a consulta financeira; as escritas serão habilitadas após o carregamento.</div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2" role="group" aria-label="Período financeiro">{([['week', 'Esta semana'], ['month', 'Este mês'], ['year', 'Este ano'], ['custom', 'Personalizado']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => setPreset(value)} className={`rounded-xl px-3 py-2 text-xs font-black ${preset === value ? 'bg-violet-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>)}</div><span className="text-xs font-bold text-slate-500">{dateLabel(period.startDate)} até {dateLabel(period.endDate)}</span></div>{preset === 'custom' && <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Data inicial"><input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)} className={inputClass} /></Field><Field label="Data final"><input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} className={inputClass} /></Field></div>}</section>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"><OverviewCard label="Recebido no mês" value={formatPsychologyMoney(overview.received)} tone="emerald" /><OverviewCard label="A receber" value={formatPsychologyMoney(overview.receivable)} tone="amber" /><OverviewCard label="Vencido" value={formatPsychologyMoney(overview.overdue)} tone="rose" /><OverviewCard label="Despesas no mês" value={formatPsychologyMoney(overview.expenses)} tone="slate" /><OverviewCard label="Saldo" value={formatPsychologyMoney(overview.balance)} tone={overview.balance >= 0 ? 'violet' : 'rose'} /></div>
    <div className="flex gap-2 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Áreas financeiras">{([['overview', 'Visão geral'], ['charges', 'Cobranças'], ['payments', 'Pagamentos'], ['expenses', 'Despesas']] as const).map(([value, label]) => <button type="button" role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-black ${tab === value ? 'border-violet-700 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>)}</div>
    {tab === 'overview' && <OverviewPanel overview={overview} onTab={setTab} />}
    {tab !== 'overview' && <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row"><label className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-3.5 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={tab === 'charges' ? 'Buscar paciente ou descrição' : tab === 'payments' ? 'Buscar paciente, cobrança ou meio' : 'Buscar descrição ou categoria'} className={`${inputClass} pl-9`} /></label>{tab === 'charges' && <select value={chargeFilter} onChange={event => setChargeFilter(event.target.value)} className={`${inputClass} sm:w-52`}><option value="all">Todas as cobranças</option><option value="pending">Pendentes</option><option value="partially_paid">Parcialmente pagas</option><option value="paid">Pagas</option><option value="overdue">Vencidas</option><option value="exempt">Isentas</option><option value="cancelled">Canceladas</option></select>}{tab === 'payments' && <select value={paymentFilter} onChange={event => setPaymentFilter(event.target.value)} className={`${inputClass} sm:w-44`}><option value="all">Todos os pagamentos</option><option value="active">Ativos</option><option value="reversed">Estornados</option></select>}{tab === 'expenses' && <select value={expenseFilter} onChange={event => setExpenseFilter(event.target.value)} className={`${inputClass} sm:w-44`}><option value="all">Todas as despesas</option><option value="REALIZED">Realizadas</option><option value="PENDING">Pendentes</option><option value="REVERSED">Estornadas</option></select>}</div>{tab === 'charges' && <ChargesList charges={charges} patientMap={patientMap} onCancel={(id) => { setReasonRequest({ type: 'charge', id }); setReason(''); }} writeBlocked={remoteWriteBlocked || processing} />}{tab === 'payments' && <PaymentsList payments={payments} charges={ledger.charges} patientMap={patientMap} onReverse={(id) => { setReasonRequest({ type: 'payment', id }); setReason(''); }} writeBlocked={remoteWriteBlocked || processing} />}{tab === 'expenses' && <ExpensesList expenses={expenses} onReverse={(id) => { setReasonRequest({ type: 'expense', id }); setReason(''); }} writeBlocked={remoteWriteBlocked || processing} />}</section>}
    {modal === 'charge' && <ChargeDialog store={store} onClose={() => setModal(null)} onSave={(input) => saveMutation(createPsychologyChargeInLedger(store, input), 'Cobrança criada.')} />}
    {modal === 'payment' && <PaymentDialog store={store} onClose={() => setModal(null)} onSave={(input) => saveMutation(createPsychologyPaymentInLedger(store, input), 'Pagamento registrado.')} />}
    {modal === 'expense' && <ExpenseDialog onClose={() => setModal(null)} onSave={(input) => saveMutation(createPsychologyExpenseInLedger(store, input), 'Despesa criada.')} />}
    {reasonRequest && <ReasonDialog type={reasonRequest.type} reason={reason} setReason={setReason} onClose={() => setReasonRequest(null)} onConfirm={confirmReason} />}
    {processing && <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/15" role="status" data-testid="psychology-finance-mutation-processing"><div className="rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-800 shadow-xl">Salvando financeiro…</div></div>}
  </div>;
}

function OverviewPanel({ overview, onTab }: { overview: ReturnType<typeof getPsychologyFinancialOverview>; onTab: (tab: FinanceTab) => void }) {
  return <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><CircleDollarSign size={18} className="text-violet-700" /><h4 className="text-lg font-black">Resumo do período</h4></div><p className="mt-2 text-sm text-slate-500">Vencido é um subconjunto de A receber e não é somado novamente ao saldo.</p><div className="mt-4 space-y-2 text-sm"><SummaryLine label="Recebimentos em caixa" value={formatPsychologyMoney(overview.received)} /><SummaryLine label="Cobranças em aberto" value={formatPsychologyMoney(overview.receivable)} /><SummaryLine label="Despesas realizadas" value={formatPsychologyMoney(overview.expenses)} /><SummaryLine label="Saldo realizado" value={formatPsychologyMoney(overview.balance)} /></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><CalendarDays size={18} className="text-violet-700" /><h4 className="text-lg font-black">Acesso rápido</h4></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><button type="button" onClick={() => onTab('charges')} className={secondaryButton}><Receipt size={15} /> Cobranças</button><button type="button" onClick={() => onTab('payments')} className={secondaryButton}><WalletCards size={15} /> Pagamentos</button><button type="button" onClick={() => onTab('expenses')} className={secondaryButton}><Banknote size={15} /> Despesas</button></div></section></div>;
}

function SummaryLine({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0"><span className="font-bold text-slate-600">{label}</span><strong className="text-slate-900">{value}</strong></div>; }

function ReasonDialog({ type, reason, setReason, onClose, onConfirm }: { type: ReasonRequest['type']; reason: string; setReason: (value: string) => void; onClose: () => void; onConfirm: () => void }) {
  const copy = type === 'charge'
    ? { title: 'Cancelar cobrança?', impact: 'A cobrança continuará no histórico, mas deixará de compor A receber e Vencido.' }
    : type === 'payment'
      ? { title: 'Estornar pagamento?', impact: 'O recebimento ativo será removido e o saldo da cobrança será recalculado.' }
      : { title: 'Estornar despesa?', impact: 'A despesa permanecerá no histórico, mas deixará de compor despesas realizadas e saldo.' };
  return <FinanceDialog title={copy.title} onClose={onClose}><p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-900">{copy.impact}</p><label className="block space-y-1.5"><span className="text-xs font-black text-slate-600">Motivo obrigatório</span><textarea autoFocus value={reason} onChange={event => setReason(event.target.value)} placeholder="Descreva o motivo da correção" className={`${inputClass} min-h-24`} /></label><div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className={secondaryButton}>Voltar</button><button type="button" onClick={onConfirm} disabled={!reason.trim()} className={primaryButton}><RotateCcw size={15} /> Confirmar correção</button></div></FinanceDialog>;
}

function ChargesList({ charges, patientMap, onCancel, writeBlocked = false }: { charges: ReturnType<typeof getPsychologyFinancialLedger>['chargeEntries']; patientMap: Map<string | null, PsychologyPatient>; onCancel: (id: string) => void; writeBlocked?: boolean }) {
  return <div className="overflow-x-auto"><div className="min-w-[900px]"><div className="grid grid-cols-[1.2fr_1.5fr_.8fr_.8fr_.8fr_.8fr_1fr_auto] gap-3 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500"><span>Paciente</span><span>Descrição</span><span>Valor</span><span>Recebido</span><span>Saldo</span><span>Vencimento</span><span>Status</span><span>Ações</span></div>{charges.length ? charges.map(entry => <div key={entry.charge.id} className="grid grid-cols-[1.2fr_1.5fr_.8fr_.8fr_.8fr_.8fr_1fr_auto] items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm"><span className="truncate font-black">{patientMap.get(entry.charge.patientId)?.name || 'Paciente não encontrado'}</span><span className="truncate text-slate-600">{entry.charge.description}</span><span className="font-bold">{formatPsychologyMoney(entry.charge.amount)}</span><span className="font-bold text-emerald-700">{formatPsychologyMoney(entry.received)}</span><span className="font-bold text-amber-700">{formatPsychologyMoney(entry.balance)}</span><span className="text-slate-600">{dateLabel(entry.charge.dueDate)}</span><span className={`inline-flex w-fit rounded-full px-2 py-1 text-[11px] font-black ${statusClass(entry.status, entry.overdue)}`}>{chargeStatusLabel(entry.status, entry.overdue)}</span><span>{entry.status !== 'CANCELLED' && entry.status !== 'PAID' && <button type="button" onClick={() => onCancel(entry.charge.id)} disabled={writeBlocked} title={writeBlocked ? 'Escrita financeira remota ainda não disponível' : undefined} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Cancelar cobrança"><X size={15} /></button>}</span></div>) : <p className="border-t border-slate-100 px-4 py-8 text-center text-sm font-bold text-slate-500">Nenhuma cobrança encontrada.</p>}</div></div>;
}

function PaymentsList({ payments, charges, patientMap, onReverse, writeBlocked = false }: { payments: ReturnType<typeof getPsychologyFinancialLedger>['payments']; charges: ReturnType<typeof getPsychologyFinancialLedger>['charges']; patientMap: Map<string | null, PsychologyPatient>; onReverse: (id: string) => void; writeBlocked?: boolean }) {
  const chargeMap = new Map<string | null, (typeof charges)[number]>(charges.map(charge => [charge.id, charge] as [string | null, (typeof charges)[number]]));
  return <div className="overflow-x-auto"><div className="min-w-[780px]"><div className="grid grid-cols-[.8fr_1.2fr_1.5fr_.8fr_1fr_1fr_auto] gap-3 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500"><span>Data</span><span>Paciente</span><span>Cobrança</span><span>Valor</span><span>Meio</span><span>Status</span><span>Ações</span></div>{payments.length ? payments.map(payment => { const active = isPsychologyPaymentActive(payment); return <div key={payment.id} className="grid grid-cols-[.8fr_1.2fr_1.5fr_.8fr_1fr_1fr_auto] items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm"><span className="text-slate-600">{dateLabel(payment.date)}</span><span className="truncate font-black">{patientMap.get(payment.patientId)?.name || 'Paciente não encontrado'}</span><span className="truncate text-slate-600">{chargeMap.get(payment.chargeId)?.description || 'Cobrança vinculada'}</span><span className="font-black text-emerald-700">{formatPsychologyMoney(payment.amount)}</span><span>{paymentMethods.find(method => method.value === payment.method)?.label || payment.method}</span><span className={`inline-flex w-fit rounded-full px-2 py-1 text-[11px] font-black ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{active ? 'Ativo' : 'Estornado'}</span><span>{active && <button type="button" onClick={() => onReverse(payment.id)} disabled={writeBlocked} title={writeBlocked ? 'Escrita financeira remota ainda não disponível' : undefined} className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Estornar pagamento"><RotateCcw size={15} /></button>}</span></div>; }) : <p className="border-t border-slate-100 px-4 py-8 text-center text-sm font-bold text-slate-500">Nenhum pagamento encontrado.</p>}</div></div>;
}

function ExpensesList({ expenses, onReverse, writeBlocked = false }: { expenses: ReturnType<typeof getPsychologyFinancialLedger>['expenses']; onReverse: (id: string) => void; writeBlocked?: boolean }) {
  return <div className="overflow-x-auto"><div className="min-w-[650px]"><div className="grid grid-cols-[.8fr_1.7fr_1.1fr_1fr_1fr_auto] gap-3 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500"><span>Data</span><span>Descrição</span><span>Categoria</span><span>Valor</span><span>Status</span><span>Ações</span></div>{expenses.length ? expenses.map(expense => <div key={expense.id} className="grid grid-cols-[.8fr_1.7fr_1.1fr_1fr_1fr_auto] items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm"><span className="text-slate-600">{dateLabel(expense.date)}</span><span className="truncate font-black">{expense.description}</span><span>{expense.category}</span><span className="font-black text-slate-900">{formatPsychologyMoney(expense.amount)}</span><span className={`inline-flex w-fit rounded-full px-2 py-1 text-[11px] font-black ${expense.status === 'REALIZED' ? 'bg-emerald-50 text-emerald-700' : expense.status === 'PENDING' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{expense.status === 'REALIZED' ? 'Realizada' : expense.status === 'PENDING' ? 'Pendente' : 'Estornada'}</span><span>{expense.status !== 'REVERSED' && <button type="button" onClick={() => onReverse(expense.id)} disabled={writeBlocked} title={writeBlocked ? 'Escrita financeira remota ainda não disponível' : undefined} className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Estornar despesa"><RotateCcw size={15} /></button>}</span></div>) : <p className="border-t border-slate-100 px-4 py-8 text-center text-sm font-bold text-slate-500">Nenhuma despesa encontrada.</p>}</div></div>;
}

function ChargeDialog({ store, onClose, onSave }: { store: PsychologyStore; onClose: () => void; onSave: (input: PsychologyChargeInputLike) => void }) {
  const [patientId, setPatientId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [exempt, setExempt] = useState(false);
  const [exemptionReason, setExemptionReason] = useState('');
  const patientSessions = store.sessions.filter(session => session.patientId === patientId && session.status !== 'cancelada').sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const patientPackages = store.sessionPackages.filter(item => item.patientId === patientId && item.active);
  const selectedService = store.services.find(service => service.id === serviceId);
  return <FinanceDialog title="Nova cobrança" onClose={onClose}><Field label="Paciente *"><select autoFocus value={patientId} onChange={event => { setPatientId(event.target.value); setSessionId(''); setPackageId(''); }} className={inputClass}><option value="">Selecione um paciente</option>{store.patients.filter(patient => patient.active).sort((a, b) => a.name.localeCompare(b.name)).map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></Field><Field label="Descrição *"><input value={description} onChange={event => setDescription(event.target.value)} placeholder="Ex.: Sessão de psicoterapia" className={inputClass} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Valor (R$) *"><input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder={selectedService ? `Sugestão: ${selectedService.defaultPrice}` : '0,00'} className={inputClass} /></Field><Field label="Vencimento (opcional)"><input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} className={inputClass} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Sessão (opcional)"><select value={sessionId} onChange={event => setSessionId(event.target.value)} className={inputClass}><option value="">Sem sessão vinculada</option>{patientSessions.map(session => <option key={session.id} value={session.id}>{dateLabel(session.date)} · {session.time}</option>)}</select></Field><Field label="Serviço (opcional)"><select value={serviceId} onChange={event => { setServiceId(event.target.value); const service = store.services.find(item => item.id === event.target.value); if (service && !amount) setAmount(String(service.defaultPrice)); }} className={inputClass}><option value="">Sem serviço</option>{store.services.filter(service => service.active).map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field></div><Field label="Pacote (opcional)"><select value={packageId} onChange={event => setPackageId(event.target.value)} className={inputClass}><option value="">Sem pacote</option>{patientPackages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><label className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-sm"><input type="checkbox" checked={exempt} onChange={event => setExempt(event.target.checked)} className="mt-0.5" /><span><strong className="block text-violet-950">Isento / cortesia</strong><span className="text-xs font-bold text-violet-800">Não gera pagamento de R$ 0,00 e não fica vencido.</span></span></label>{exempt && <Field label="Justificativa opcional"><input value={exemptionReason} onChange={event => setExemptionReason(event.target.value)} placeholder="Ex.: cortesia administrativa" className={inputClass} /></Field>}<div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className={secondaryButton}>Fechar</button><button type="button" disabled={!patientId || !description.trim() || !amount} onClick={() => onSave({ patientId, sessionId: sessionId || undefined, description, amount: Number(amount.replace(',', '.')), dueDate: dueDate || undefined, serviceId: serviceId || undefined, packageId: packageId || undefined, exempt, exemptionReason })} className={primaryButton}><Check size={16} /> Criar cobrança</button></div></FinanceDialog>;
}

type PsychologyChargeInputLike = PsychologyChargeInputForLedger;
type PsychologyChargeInputForLedger = { patientId: string; description: string; amount: number; dueDate?: string; sessionId?: string; serviceId?: string; packageId?: string; exempt?: boolean; exemptionReason?: string; createdBy?: string };

function PaymentDialog({ store, onClose, onSave }: { store: PsychologyStore; onClose: () => void; onSave: (input: PsychologyPaymentInputLike) => void }) {
  const ledger = getPsychologyFinancialLedger(store);
  const [chargeId, setChargeId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(psychologyCivilDate());
  const [method, setMethod] = useState<PsychologyPaymentMethod>('PIX');
  const selected = ledger.chargeEntries.find(entry => entry.charge.id === chargeId);
  return <FinanceDialog title="Registrar pagamento" onClose={onClose}><Field label="Cobrança *"><select autoFocus value={chargeId} onChange={event => { setChargeId(event.target.value); setAmount(''); }} className={inputClass}><option value="">Selecione uma cobrança</option>{ledger.chargeEntries.filter(entry => entry.balance > 0 && entry.status !== 'EXEMPT' && entry.status !== 'CANCELLED').map(entry => <option key={entry.charge.id} value={entry.charge.id}>{store.patients.find(patient => patient.id === entry.charge.patientId)?.name || 'Paciente'} · {entry.charge.description} · saldo {formatPsychologyMoney(entry.balance)}</option>)}</select></Field>{selected && <div className="grid grid-cols-3 gap-2 rounded-xl border border-violet-100 bg-violet-50/60 p-3 text-center text-xs"><div><span className="block font-bold text-slate-500">Original</span><strong>{formatPsychologyMoney(selected.charge.amount)}</strong></div><div><span className="block font-bold text-slate-500">Recebido</span><strong>{formatPsychologyMoney(selected.received)}</strong></div><div><span className="block font-bold text-slate-500">Saldo</span><strong className="text-amber-700">{formatPsychologyMoney(selected.balance)}</strong></div></div>}<div className="grid gap-3 sm:grid-cols-2"><Field label="Valor recebido (R$) *"><input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" className={inputClass} /></Field><Field label="Data *"><input type="date" value={date} onChange={event => setDate(event.target.value)} className={inputClass} /></Field></div><Field label="Meio de pagamento *"><select value={method} onChange={event => setMethod(event.target.value as PsychologyPaymentMethod)} className={inputClass}>{paymentMethods.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">Pagamento parcial e múltiplos pagamentos são permitidos. O valor acima do saldo é bloqueado pelo ledger.</p><div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className={secondaryButton}>Fechar</button><button type="button" disabled={!selected || !amount || !date} onClick={() => selected && onSave({ chargeId, patientId: selected.charge.patientId, amount: Number(amount.replace(',', '.')), date, method })} className={primaryButton}><Check size={16} /> Registrar pagamento</button></div></FinanceDialog>;
}

type PsychologyPaymentInputLike = { chargeId: string; patientId: string; amount: number; date: string; method: PsychologyPaymentMethod; createdBy?: string };

function ExpenseDialog({ onClose, onSave }: { onClose: () => void; onSave: (input: PsychologyExpenseInput) => void }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(psychologyCivilDate());
  const [category, setCategory] = useState<PsychologyExpenseCategory>('Outros');
  const [status, setStatus] = useState<PsychologyExpenseStatus>('REALIZED');
  return <FinanceDialog title="Nova despesa" onClose={onClose}><Field label="Descrição *"><input autoFocus value={description} onChange={event => setDescription(event.target.value)} placeholder="Ex.: Aluguel da sala" className={inputClass} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Valor (R$) *"><input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" className={inputClass} /></Field><Field label="Data *"><input type="date" value={date} onChange={event => setDate(event.target.value)} className={inputClass} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Categoria"><select value={category} onChange={event => setCategory(event.target.value as PsychologyExpenseCategory)} className={inputClass}>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></Field><Field label="Status"><select value={status} onChange={event => setStatus(event.target.value as PsychologyExpenseStatus)} className={inputClass}><option value="REALIZED">Realizada</option><option value="PENDING">Pendente</option></select></Field></div><div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className={secondaryButton}>Fechar</button><button type="button" disabled={!description.trim() || !amount || !date} onClick={() => onSave({ description, amount: Number(amount.replace(',', '.')), date, category, status })} className={primaryButton}><Check size={16} /> Criar despesa</button></div></FinanceDialog>;
}
