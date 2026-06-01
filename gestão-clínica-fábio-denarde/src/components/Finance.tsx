import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppState, Payment, PaymentModal, SessionStatus, Expense, Session, Patient } from '../types';
import { DollarSign, Plus, Search, History, Trash2, TrendingUp, TrendingDown, Wallet, Link, Calendar as CalendarIcon } from 'lucide-react';
import { formatCurrency, cn, safeFormatDate } from '../lib/utils';
import { format, isWithinInterval, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, startOfDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Modal from './Common/Modal';
import { showToast } from './Common/Toast';

interface FinanceProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void;
}

interface ExpectedPayment {
  id: string;
  amount: number;
  date: Date;
  status: 'PENDENTE' | 'PARCIAL' | 'QUITADO' | 'ATRASADO';
  paidAmount: number;
  pendingAmount: number;
}

export default function Finance({ state, onUpdate }: FinanceProps) {
  const [viewMode, setViewMode] = useState<'Receitas' | 'Despesas'>('Receitas');
  
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentToDelete, setPaymentToDelete] = useState<string | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);

  // Period Filter State
  const [periodFilter, setPeriodFilter] = useState<'Semanal' | 'Mensal' | 'Anual' | 'Personalizado'>('Mensal');
  const [customStartDate, setCustomStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customEndDate, setCustomEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  // Payment Form State
  const [patientId, setPatientId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [installment, setInstallment] = useState<'1ª parcela' | '2ª parcela' | 'Pagamento integral'>('Pagamento integral');
  const [method, setMethod] = useState<'Pix' | 'Dinheiro' | 'Transferência' | 'Outro'>('Pix');

  // Expense Form State
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState<number>(0);
  const [expenseDate, setExpenseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expenseCategory, setExpenseCategory] = useState<Expense['category']>('Outro');

  const syncLock = useRef(false);

  // Sincronização, Limpeza e Blindagem de Alterações (Datas/Valores)
  useEffect(() => {
    if (!state.payments || !state.expenses) return;
    if (syncLock.current) return;

    const currentExpenses = state.expenses;
    const expensesToDelete: string[] = [];
    const missingExpenses: Expense[] = [];

    const validPaymentsMap = new Map(state.payments.map(p => [p.id, p]));
    const repasseByPaymentId = new Map();

    currentExpenses.forEach(e => {
      if (e.auto_gerado && e.pagamento_origem_id) {
        const parentPayment = validPaymentsMap.get(e.pagamento_origem_id);
        
        if (!parentPayment) {
          expensesToDelete.push(e.id);
        } else if (repasseByPaymentId.has(e.pagamento_origem_id)) {
          expensesToDelete.push(e.id);
        } else if (e.date !== parentPayment.date || e.amount !== (parentPayment.amount * 0.2)) {
          expensesToDelete.push(e.id);
        } else {
          repasseByPaymentId.set(e.pagamento_origem_id, e);
        }
      }
    });

    state.payments.forEach(payment => {
      if (!repasseByPaymentId.has(payment.id)) {
        const patientName = state.patients?.find(p => p.id === payment.patientId)?.name || 'Atendente';
        missingExpenses.push({
          id: Math.random().toString(36).substr(2, 9) + Date.now().toString(36),
          description: `Repasse Sócia - ${patientName}`,
          amount: payment.amount * 0.2, 
          date: payment.date, 
          category: 'Repasse Sócia',
          auto_gerado: true,
          pagamento_origem_id: payment.id,
        });
      }
    });

    if (expensesToDelete.length > 0 || missingExpenses.length > 0) {
      syncLock.current = true;
      const updatedExpenses = currentExpenses.filter(e => !expensesToDelete.includes(e.id));
      onUpdate({ expenses: [...updatedExpenses, ...missingExpenses] });
      
      if (expensesToDelete.length > 0) {
        showToast(`Manutenção: Repasses corrigidos para acompanhar as datas originais.`, 'success');
      }

      setTimeout(() => {
        syncLock.current = false;
      }, 2000);
    }
  }, [state.payments, state.expenses, state.patients, onUpdate]);

  const interval = useMemo(() => {
    const now = new Date();
    if (periodFilter === 'Semanal') return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    if (periodFilter === 'Mensal') return { start: startOfMonth(now), end: endOfMonth(now) };
    if (periodFilter === 'Anual') return { start: startOfYear(now), end: endOfYear(now) };
    
    const start = new Date(customStartDate + 'T00:00:00');
    const end = new Date(customEndDate + 'T23:59:59');
    return { start, end };
  }, [periodFilter, customStartDate, customEndDate]);

  const intervalDisplay = useMemo(() => {
    if (periodFilter === 'Semanal') {
      return `${format(interval.start, 'dd/MM/yyyy')} a ${format(interval.end, 'dd/MM/yyyy')}`;
    }
    if (periodFilter === 'Mensal') {
      const mStr = format(interval.start, "MMMM yyyy", { locale: ptBR });
      return mStr.charAt(0).toUpperCase() + mStr.slice(1);
    }
    if (periodFilter === 'Anual') {
      return `Janeiro a Dezembro ${format(interval.start, 'yyyy')}`;
    }
    return `${format(interval.start, 'dd/MM/yyyy')} a ${format(interval.end, 'dd/MM/yyyy')}`;
  }, [interval, periodFilter]);

  const patientFinancials = useMemo(() => {
    const today = startOfDay(new Date());
    
    return state.patients.filter(p => p.status === 'Ativo' || state.payments.some(pm => pm.patientId === p.id)).map(patient => {
      const patientPayments = state.payments
        .filter(p => p.patientId === patient.id)
        .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
      const totalPaid = patientPayments.reduce((s, p) => s + p.amount, 0);
      const pagoNoPacoteAtual = totalPaid % 1000;
      
      const expectedPayments: ExpectedPayment[] = [];
      
      if (pagoNoPacoteAtual > 0) {
        const currentPackageIndex = Math.floor(totalPaid / 1000);
        const allPatientSessions = state.sessions
          .filter(s => s.patientId === patient.id && s.status !== SessionStatus.CANCELADA && !s.isBlocked)
          .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          
        const sixthSession = allPatientSessions[currentPackageIndex * 10 + 5];
        const dueDate = sixthSession ? parseISO(sixthSession.date) : today;
        
        const isAtrasado = dueDate < today;
        
        expectedPayments.push({
          id: `pkg_${currentPackageIndex}_rem`,
          amount: 1000 - pagoNoPacoteAtual,
          date: dueDate,
          status: isAtrasado ? 'ATRASADO' : 'PENDENTE',
          paidAmount: 0,
          pendingAmount: 1000 - pagoNoPacoteAtual
        });
      }
      
      return { patient, expectedPayments, patientPayments, totalPaid, pagoNoPacoteAtual };
    });
  }, [state.patients, state.sessions, state.payments]);

  const metrics = useMemo(() => {
    let recebidoNoPeriodo = 0;
    let previstoNoPeriodo = 0;
    let saldoEmAberto = 0;
    let saldoAtrasado = 0;
    let despesasNoPeriodo = 0;
  
    state.payments.forEach(p => {
      if (isWithinInterval(parseISO(p.date), interval)) recebidoNoPeriodo += p.amount;
    });
    
    (state.expenses || []).forEach(e => {
      if (isWithinInterval(parseISO(e.date), interval)) despesasNoPeriodo += e.amount;
    });
  
    patientFinancials.forEach(pf => {
      pf.expectedPayments.forEach(exp => {
        if (isWithinInterval(exp.date, interval) && exp.pendingAmount > 0) {
          previstoNoPeriodo += exp.pendingAmount;
        }
        if (exp.status === 'ATRASADO') saldoAtrasado += exp.pendingAmount;
        else if (exp.status === 'PENDENTE' || exp.status === 'PARCIAL') saldoEmAberto += exp.pendingAmount;
      });
    });

    saldoEmAberto = saldoEmAberto * 0.8;
    saldoAtrasado = saldoAtrasado * 0.8;
  
    return { 
      recebidoNoPeriodo, 
      previstoNoPeriodo, 
      totalReceitas: recebidoNoPeriodo,
      saldoEmAberto, 
      saldoAtrasado,
      despesasNoPeriodo,
      lucroLiquido: recebidoNoPeriodo - despesasNoPeriodo
    };
  }, [patientFinancials, state.payments, state.expenses, interval]);

  const patientList = useMemo(() => {
    return patientFinancials.filter(pf => pf.patient.status === 'Ativo').map(pf => {
      const paymentsInPeriod = pf.patientPayments.filter(p => isWithinInterval(parseISO(p.date), interval));
      const valorJaPago = paymentsInPeriod.reduce((s, p) => s + p.amount, 0);
      
      const expectedInPeriod = pf.expectedPayments.filter(exp => isWithinInterval(exp.date, interval) && exp.pendingAmount > 0);
      const valorPendente = expectedInPeriod.reduce((s, exp) => s + exp.pendingAmount, 0);
      
      const hasOverdue = expectedInPeriod.some(exp => exp.status === 'ATRASADO');
      
      let indicator = 'QUITADO';
      if (valorPendente > 0) {
        if (hasOverdue) indicator = 'ATRASADO';
        else indicator = 'PENDENTE';
      }

      return {
        ...pf.patient,
        valorJaPago,
        valorPendente,
        indicator,
        pagoNoPacoteAtual: pf.pagoNoPacoteAtual,
        pacotesCompletos: Math.floor(pf.totalPaid / 1000)
      };
    }).filter(p => {
        const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        return normalize(p.name).includes(normalize(searchTerm));
      })
      .sort((a,b) => {
        if (a.indicator === 'ATRASADO' && b.indicator !== 'ATRASADO') return -1;
        if (b.indicator === 'ATRASADO' && a.indicator !== 'ATRASADO') return 1;
        return a.name.localeCompare(b.name);
      });
  }, [patientFinancials, interval, searchTerm]);

  const groupedTransactions = useMemo(() => {
    const inPeriod = state.payments.filter(p => isWithinInterval(parseISO(p.date), interval))
      .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
    const groups: Record<string, { total: number, count: number, items: Payment[] }> = {};
    inPeriod.forEach(p => {
      const monthStr = format(parseISO(p.date), "MMMM yyyy", { locale: ptBR });
      const key = monthStr.charAt(0).toUpperCase() + monthStr.slice(1);
      if (!groups[key]) groups[key] = { total: 0, count: 0, items: [] };
      groups[key].total += p.amount;
      groups[key].count += 1;
      groups[key].items.push(p);
    });
    return groups;
  }, [state.payments, interval]);

  const groupedExpenses = useMemo(() => {
    const inPeriod = (state.expenses || []).filter(e => isWithinInterval(parseISO(e.date), interval))
      .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
    const groups: Record<string, { total: number, count: number, items: Expense[] }> = {};
    inPeriod.forEach(e => {
      const monthStr = format(parseISO(e.date), "MMMM yyyy", { locale: ptBR });
      const key = monthStr.charAt(0).toUpperCase() + monthStr.slice(1);
      if (!groups[key]) groups[key] = { total: 0, count: 0, items: [] };
      groups[key].total += e.amount;
      groups[key].count += 1;
      groups[key].items.push(e);
    });
    return groups;
  }, [state.expenses, interval]);

  const handleSavePayment = () => {
    if (!patientId || amount <= 0) {
      showToast('Preencha os dados corretamente.', 'error');
      return;
    }

    const newPayment: Payment = {
      id: Math.random().toString(36).substr(2, 9),
      patientId, amount, date, installment, method
    };

    const patientName = state.patients.find(p => p.id === patientId)?.name || 'Atendente';
    const repasseAmount = amount * 0.2;
    const novaDepesa: Expense = {
      id: Math.random().toString(36).substr(2, 9),
      description: `Repasse Sócia - ${patientName}`,
      amount: repasseAmount,
      date: date,
      category: 'Repasse Sócia',
      auto_gerado: true,
      pagamento_origem_id: newPayment.id,
    };

    onUpdate({
      payments: [...state.payments, newPayment],
      expenses: [...(state.expenses || []), novaDepesa],
    });

    showToast(`Pagamento registado! Repasse de ${formatCurrency(repasseAmount)} gerado automaticamente.`);
    setIsPaymentModalOpen(false);
    resetPaymentForm();
  };

  const handleSaveExpense = () => {
    if (!expenseDesc || expenseAmount <= 0) {
      showToast('Preencha os dados corretamente.', 'error');
      return;
    }
    const newExpense: Expense = {
      id: Math.random().toString(36).substr(2, 9),
      description: expenseDesc,
      amount: expenseAmount,
      date: expenseDate,
      category: expenseCategory
    };
    onUpdate({ expenses: [...(state.expenses || []), newExpense] });
    showToast('Despesa registada com sucesso!');
    setIsExpenseModalOpen(false);
    resetExpenseForm();
  };

  const resetPaymentForm = () => {
    setPatientId(''); setAmount(0); setDate(format(new Date(), 'yyyy-MM-dd'));
    setInstallment('Pagamento integral'); setMethod('Pix');
  };

  const resetExpenseForm = () => {
    setExpenseDesc(''); setExpenseAmount(0); setExpenseDate(format(new Date(), 'yyyy-MM-dd')); setExpenseCategory('Outro');
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      
      {/* Top Filter */}
      <div className="bg-clinic-surface p-4 rounded-2xl border border-clinic-border shadow-sm flex flex-col gap-3">
        <div className="flex flex-col md:flex-row items-center gap-4 justify-between">
          <div className="flex bg-clinic-bg p-1 rounded-xl w-full md:w-auto">
            {['Semanal', 'Mensal', 'Anual', 'Personalizado'].map(f => (
              <button 
                key={f}
                onClick={() => setPeriodFilter(f as any)}
                className={cn(
                  "flex-1 md:flex-none px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all", 
                  periodFilter === f ? 'bg-clinic-text text-white shadow-md' : 'text-clinic-text-muted hover:text-clinic-text'
                )}
              >
                {f}
              </button>
            ))}
          </div>
          {periodFilter === 'Personalizado' && (
            <div className="flex items-center gap-2 w-full md:w-auto">
              <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="px-3 py-2 bg-clinic-bg rounded-lg border border-clinic-border text-xs focus:ring-1 focus:ring-clinic-primary outline-none" />
              <span className="text-clinic-text-faint text-xs font-bold">até</span>
              <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="px-3 py-2 bg-clinic-bg rounded-lg border border-clinic-border text-xs focus:ring-1 focus:ring-clinic-primary outline-none" />
            </div>
          )}
        </div>
        {periodFilter !== 'Personalizado' && (
          <div className="text-center md:text-left text-xs font-bold text-clinic-text-muted uppercase tracking-widest px-2">
            Período: {intervalDisplay}
          </div>
        )}
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Receitas */}
        <div className="bg-clinic-surface p-5 rounded-2xl border border-clinic-border shadow-clinic flex flex-col">
          <div className="flex justify-between items-start mb-3">
            <div className="flex items-center gap-2 text-clinic-text">
              <TrendingUp size={16} />
              <p className="text-[10px] uppercase font-bold tracking-widest">Receitas ({periodFilter})</p>
            </div>
            <p className="text-lg font-black text-clinic-text">{formatCurrency(metrics.totalReceitas)}</p>
          </div>
          <div className="flex justify-between items-center text-xs mt-auto pt-3 border-t border-clinic-border">
             <div className="flex flex-col"><span className="text-[10px] text-clinic-text-faint uppercase font-bold">✅ Recebido</span><span className="font-bold text-status-green-text">{formatCurrency(metrics.recebidoNoPeriodo)}</span></div>
             <div className="flex flex-col items-end"><span className="text-[10px] text-clinic-text-faint uppercase font-bold">⏳ Previsto</span><span className="font-bold text-status-orange-text">{formatCurrency(metrics.previstoNoPeriodo)}</span></div>
          </div>
        </div>

        {/* Saldo a Receber */}
        <div className="bg-clinic-surface p-5 rounded-2xl border border-clinic-border shadow-clinic flex flex-col">
          <div className="flex items-center gap-2 mb-3 text-clinic-text">
            <DollarSign size={16} />
            <p className="text-[10px] uppercase font-bold tracking-widest">Saldo a Receber</p>
          </div>
          <div className="flex justify-between items-center text-xs mt-auto pt-3 border-t border-clinic-border">
             <div className="flex flex-col"><span className="text-[10px] text-clinic-text-faint uppercase font-bold">⏳ Em aberto</span><span className="font-bold text-status-orange-text">{formatCurrency(metrics.saldoEmAberto)}</span></div>
             <div className="flex flex-col items-end"><span className="text-[10px] text-clinic-text-faint uppercase font-bold">⚠️ Atrasado</span><span className="font-bold text-status-red-text">{formatCurrency(metrics.saldoAtrasado)}</span></div>
          </div>
        </div>

        {/* Lucro Liquido */}
        <div className="bg-clinic-surface p-5 rounded-2xl border border-clinic-border shadow-clinic flex flex-col relative overflow-hidden">
          <div className="absolute inset-0 bg-clinic-primary/5 pointer-events-none"></div>
          <div className="flex items-center gap-2 mb-1 text-clinic-primary">
            <Wallet size={16} />
            <p className="text-[10px] uppercase font-bold tracking-widest">Lucro Líquido</p>
          </div>
          <p className="text-2xl font-black text-clinic-text relative z-10">{formatCurrency(metrics.lucroLiquido)}</p>
          <div className="flex justify-between items-center text-[10px] mt-auto pt-3 border-t border-clinic-border opacity-70">
             <span className="font-bold">Receitas recebidas</span>
             <span className="font-bold">- Despesas do período</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-clinic-surface p-4 rounded-2xl border border-clinic-border shadow-sm">
        <div className="flex bg-clinic-bg p-1 rounded-xl w-full md:w-auto">
          <button 
            onClick={() => setViewMode('Receitas')}
            className={cn("flex-1 md:flex-none px-6 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all", viewMode === 'Receitas' ? 'bg-white shadow-sm text-clinic-text' : 'text-clinic-text-muted hover:text-clinic-text')}
          >
            Receitas
          </button>
          <button 
            onClick={() => setViewMode('Despesas')}
            className={cn("flex-1 md:flex-none px-6 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all", viewMode === 'Despesas' ? 'bg-white shadow-sm text-clinic-text' : 'text-clinic-text-muted hover:text-clinic-text')}
          >
            Despesas
          </button>
        </div>

        {viewMode === 'Receitas' ? (
          <div className="flex w-full md:w-auto gap-4">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-clinic-text-faint" size={16} />
              <input 
                type="text" placeholder="Buscar atendente..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-clinic-bg rounded-xl border border-clinic-border focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-xs"
              />
            </div>
            <button onClick={() => setIsPaymentModalOpen(true)} className="flex items-center gap-2 px-4 py-2.5 bg-clinic-primary text-white font-bold rounded-xl shadow-md hover:bg-clinic-primary-hover transition-all uppercase tracking-widest text-[10px]">
              <Plus size={16} /> Nova Receita
            </button>
          </div>
        ) : (
          <button onClick={() => setIsExpenseModalOpen(true)} className="w-full md:w-auto flex items-center gap-2 px-6 py-2.5 bg-status-red-text text-white font-bold rounded-xl shadow-md hover:bg-red-700 transition-all uppercase tracking-widest text-xs justify-center">
            <Plus size={16} /> Nova Despesa
          </button>
        )}
      </div>

      {viewMode === 'Receitas' && (
        <div className="flex flex-col gap-6">
          <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm">
            <div className="px-6 py-4 border-b border-clinic-border flex items-center gap-2">
              <DollarSign size={20} />
              <h2 className="font-serif text-xl font-bold">Situação por Atendente ({periodFilter})</h2>
            </div>
            <div className="p-6 space-y-4">
              {patientList.map(item => {
                let colorClass = "bg-white border-clinic-border";
                let textClass = "text-clinic-text-muted";
                
                if (item.indicator === 'ATRASADO') { colorClass = "bg-status-red-bg border-red-200"; textClass = "text-status-red-text"; }
                else if (item.indicator === 'QUITADO') { textClass = "text-status-green-text"; }
                else if (item.indicator === 'PARCIAL') { textClass = "text-status-orange-text"; }

                return (
                <div key={item.id} className={cn("p-4 rounded-xl border transition-all flex flex-col md:flex-row items-center gap-4 hover:shadow-sm", colorClass)}>
                  <div className="flex-1 w-full text-center md:text-left">
                    <div className="flex flex-col md:flex-row md:items-center gap-2">
                      <h4 className="font-bold text-clinic-text">{item.name}</h4>
                      <span className="text-[10px] text-clinic-text-faint font-bold uppercase px-2 py-0.5 bg-clinic-bg/50 rounded">{item.paymentModal.split(': ')[0]}</span>
                    </div>
                    <div className="flex flex-col md:flex-row items-center gap-4 mt-2">
                       <div className="text-xs text-clinic-text-muted">Pago no período: <span className="font-bold text-clinic-text">{formatCurrency(item.valorJaPago)}</span></div>
                       <div className="text-xs text-clinic-text-muted">Pendente no período: <span className="font-bold text-clinic-text">{formatCurrency(item.valorPendente)}</span></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end">
                    <div className={cn("px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-white shadow-sm border border-clinic-border", textClass)}>{item.indicator}</div>
                  </div>
                </div>
              )})}
              {patientList.length === 0 && <p className="text-center text-sm text-clinic-text-muted italic py-4">Nenhum dado financeiro de receitas para o período selecionado.</p>}
            </div>
          </div>

          <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm overflow-hidden">
             <div className="px-6 py-4 border-b border-clinic-border flex items-center gap-2 bg-clinic-bg/10">
              <History size={20} className="text-clinic-text-faint" />
              <h2 className="font-serif text-xl font-bold">Histórico de Transações</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-clinic-bg/50 text-[10px] font-bold uppercase tracking-widest text-clinic-text-faint border-b border-clinic-border">
                    <th className="px-6 py-4">Data</th>
                    <th className="px-6 py-4">Atendente</th>
                    <th className="px-6 py-4">Parcela</th>
                    <th className="px-6 py-4">Forma</th>
                    <th className="px-6 py-4 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-clinic-border">
                  {(Object.entries(groupedTransactions) as [string, { total: number, count: number, items: Payment[] }][]).map(([monthYear, group]) => (
                    <React.Fragment key={monthYear}>
                      <tr className="bg-clinic-bg/20 border-y border-clinic-border">
                        <td colSpan={5} className="px-6 py-3">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-clinic-text text-sm uppercase tracking-wide">{monthYear}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] uppercase font-bold text-clinic-text-faint bg-white px-2 py-1 rounded shadow-sm">{group.count} transaç{group.count > 1 ? 'ões' : 'ão'}</span>
                              <span className="font-black text-status-green-text ml-2">{formatCurrency(group.total)}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {group.items.map(p => (
                        <tr key={p.id} className="hover:bg-clinic-bg/30 transition-colors group">
                          <td className="px-6 py-4 text-sm whitespace-nowrap">{safeFormatDate(p.date, 'dd/MM/yyyy')}</td>
                          <td className="px-6 py-4 text-sm font-bold text-clinic-text">{state.patients.find(pt => pt.id === p.patientId)?.name || 'Desconhecido'}</td>
                          <td className="px-6 py-4 text-xs">{p.installment}</td>
                          <td className="px-6 py-4"><span className="px-2 py-1 bg-clinic-bg rounded text-[10px] font-bold text-clinic-text-muted">{p.method}</span></td>
                          <td className="px-6 py-4 text-right text-sm font-bold text-status-green-text flex items-center justify-end gap-3">
                            {formatCurrency(p.amount)}
                            <button onClick={() => setPaymentToDelete(p.id)} className="p-1.5 text-status-red-text bg-status-red-bg rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              {Object.keys(groupedTransactions).length === 0 && <p className="py-10 text-center text-clinic-text-muted italic text-sm">Nenhum pagamento registado neste período.</p>}
            </div>
          </div>
        </div>
      )}

      {viewMode === 'Despesas' && (
        <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm overflow-hidden">
           <div className="px-6 py-4 border-b border-clinic-border flex items-center gap-2 bg-clinic-bg/10">
            <History size={20} className="text-clinic-text-faint" />
            <h2 className="font-serif text-xl font-bold">Histórico de Despesas</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-clinic-bg/50 text-[10px] font-bold uppercase tracking-widest text-clinic-text-faint border-b border-clinic-border">
                  <th className="px-6 py-4">Data</th>
                  <th className="px-6 py-4">Descrição</th>
                  <th className="px-6 py-4">Categoria</th>
                  <th className="px-6 py-4 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clinic-border">
                {(Object.entries(groupedExpenses) as [string, { total: number, count: number, items: Expense[] }][]).map(([monthYear, group]) => (
                  <React.Fragment key={monthYear}>
                    <tr className="bg-clinic-bg/20 border-y border-clinic-border">
                      <td colSpan={4} className="px-6 py-3">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-clinic-text text-sm uppercase tracking-wide">{monthYear}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] uppercase font-bold text-clinic-text-faint bg-white px-2 py-1 rounded shadow-sm">{group.count} transaç{group.count > 1 ? 'ões' : 'ão'}</span>
                            <span className="font-black text-status-red-text ml-2">- {formatCurrency(group.total)}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {group.items.map(e => (
                      <tr key={e.id} className="hover:bg-clinic-bg/30 transition-colors group">
                        <td className="px-6 py-4 text-sm whitespace-nowrap">{safeFormatDate(e.date, 'dd/MM/yyyy')}</td>
                        <td className="px-6 py-4 text-sm font-bold text-clinic-text">
                          <div className="flex items-center gap-2">
                            {e.description}
                            {e.auto_gerado && (
                              <span title="Gerado automaticamente pelo sistema" className="inline-flex items-center gap-1 px-2 py-0.5 bg-clinic-bg border border-clinic-border rounded text-[10px] text-clinic-text-faint font-bold">
                                <Link size={10} /> Auto
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4"><span className="px-2 py-1 bg-clinic-bg rounded text-[10px] font-bold text-clinic-text-muted">{e.category}</span></td>
                        <td className="px-6 py-4 text-right text-sm font-bold text-status-red-text flex items-center justify-end gap-3">
                          - {formatCurrency(e.amount)}
                          {!e.auto_gerado && (
                            <button onClick={() => setExpenseToDelete(e.id)} className="p-1.5 text-status-red-text bg-status-red-bg rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {Object.keys(groupedExpenses).length === 0 && <p className="py-10 text-center text-clinic-text-muted italic text-sm">Nenhuma despesa registada neste período.</p>}
          </div>
        </div>
      )}

      {/* Modais de Exclusão e Inclusão mantidos idênticos... */}
      <Modal isOpen={!!paymentToDelete} onClose={() => setPaymentToDelete(null)} title="Confirmar Exclusão" width="max-w-md">
        <div className="space-y-6">
          <p className="text-clinic-text">Deseja realmente excluir esta receita? O repasse automático da sócia vinculado também será removido.</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setPaymentToDelete(null)} className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all uppercase tracking-wide text-xs">Cancelar</button>
            <button
              onClick={() => {
                if (paymentToDelete) {
                  onUpdate({
                    payments: state.payments.filter(pm => pm.id !== paymentToDelete),
                    expenses: (state.expenses || []).filter(e => e.pagamento_origem_id !== paymentToDelete),
                  });
                  showToast('Receita e repasse excluídos');
                  setPaymentToDelete(null);
                }
              }}
              className="px-4 py-2 bg-status-red-text text-white font-bold rounded-lg shadow-md hover:bg-red-700 transition-all uppercase tracking-wide text-xs"
            >
              Excluir
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title="Nova Receita">
        <div className="space-y-5">
           <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-clinic-text-faint uppercase">Atendente</label>
            <select value={patientId} onChange={(e) => setPatientId(e.target.value)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all">
              <option value="">Selecione o atendente...</option>
              {state.patients.filter(p => p.status === 'Ativo').sort((a,b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-clinic-text-faint uppercase">Valor (R$)</label>
              <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-clinic-text-faint uppercase">Data</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-clinic-text-faint uppercase">Parcela</label>
              <select value={installment} onChange={e => setInstallment(e.target.value as any)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none">
                <option value="Pagamento integral">Pagamento integral</option><option value="1ª parcela">1ª parcela</option><option value="2ª parcela">2ª parcela</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-clinic-text-faint uppercase">Forma</label>
              <select value={method} onChange={e => setMethod(e.target.value as any)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none">
                <option value="Pix">Pix</option><option value="Dinheiro">Dinheiro</option><option value="Transferência">Transferência</option><option value="Outro">Outro</option>
              </select>
            </div>
          </div>
          {amount > 0 && (
            <div className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border text-xs text-clinic-text-muted">
              Repasse automático para sócia: <span className="font-bold text-clinic-text">{formatCurrency(amount * 0.2)}</span>
            </div>
          )}
          <button onClick={handleSavePayment} disabled={!patientId || amount <= 0} className="w-full py-4 bg-clinic-primary text-white font-bold rounded-xl shadow-xl hover:bg-clinic-primary-hover transition-all uppercase tracking-widest disabled:opacity-50">Confirmar Recebimento</button>
        </div>
      </Modal>

      <Modal isOpen={!!expenseToDelete} onClose={() => setExpenseToDelete(null)} title="Confirmar Exclusão" width="max-w-md">
        <div className="space-y-6">
          <p className="text-clinic-text">Deseja realmente excluir esta despesa?</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setExpenseToDelete(null)} className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all uppercase tracking-wide text-xs">Cancelar</button>
            <button onClick={() => { if (expenseToDelete) { onUpdate({ expenses: (state.expenses || []).filter(e => e.id !== expenseToDelete) }); showToast('Despesa excluída'); setExpenseToDelete(null); } }} className="px-4 py-2 bg-status-red-text text-white font-bold rounded-lg shadow-md hover:bg-red-700 transition-all uppercase tracking-wide text-xs">Excluir</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isExpenseModalOpen} onClose={() => setIsExpenseModalOpen(false)} title="Nova Despesa">
        <div className="space-y-5">
           <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-clinic-text-faint uppercase">Descrição</label>
            <input type="text" placeholder="Ex: Conta de Luz, Aluguel..." value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all" />
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-clinic-text-faint uppercase">Valor (R$)</label>
              <input type="number" value={expenseAmount} onChange={e => setExpenseAmount(Number(e.target.value))} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-clinic-text-faint uppercase">Data</label>
              <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-clinic-text-faint uppercase">Categoria</label>
            <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value as any)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none">
              <option value="Aluguel">Aluguel</option><option value="Energia">Energia</option><option value="Internet">Internet</option><option value="Materiais">Materiais</option><option value="Impostos">Impostos</option><option value="Repasse Sócia">Repasse Sócia</option><option value="Outro">Outro</option>
            </select>
          </div>
          <button onClick={handleSaveExpense} disabled={!expenseDesc || expenseAmount <= 0} className="w-full py-4 bg-status-red-text text-white font-bold rounded-xl shadow-xl hover:bg-red-700 transition-all uppercase tracking-widest disabled:opacity-50">Confirmar Despesa</button>
        </div>
      </Modal>

    </div>
  );
}