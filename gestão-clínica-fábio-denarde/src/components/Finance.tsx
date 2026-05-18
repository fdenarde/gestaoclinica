import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppState, Payment, PaymentModal, SessionStatus, Expense } from '../types';
import { DollarSign, Plus, Search, History, Trash2, TrendingUp, TrendingDown, Wallet, Link } from 'lucide-react';
import { formatCurrency, cn, getStatusColor, safeFormatDate } from '../lib/utils';
import { format } from 'date-fns';
import Modal from './Common/Modal';
import { showToast } from './Common/Toast';

interface FinanceProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void;
}

export default function Finance({ state, onUpdate }: FinanceProps) {
  const [viewMode, setViewMode] = useState<'Receitas' | 'Despesas'>('Receitas');
  
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentToDelete, setPaymentToDelete] = useState<string | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);

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

    // Mapeia os pagamentos reais para checar dados profundos (data e valor)
    const validPaymentsMap = new Map(state.payments.map(p => [p.id, p]));
    const repasseByPaymentId = new Map();

    currentExpenses.forEach(e => {
      if (e.auto_gerado && e.pagamento_origem_id) {
        const parentPayment = validPaymentsMap.get(e.pagamento_origem_id);
        
        if (!parentPayment) {
          // ÓRFÃO: Pagamento foi excluído
          expensesToDelete.push(e.id);
        } else if (repasseByPaymentId.has(e.pagamento_origem_id)) {
          // DUPLICADO puro
          expensesToDelete.push(e.id);
        } else if (e.date !== parentPayment.date || e.amount !== (parentPayment.amount * 0.2)) {
          // DESATUALIZADO: Você alterou a data ou o valor da receita. O repasse precisa reciclar.
          expensesToDelete.push(e.id);
        } else {
          // 100% VÁLIDO E SINCRONIZADO
          repasseByPaymentId.set(e.pagamento_origem_id, e);
        }
      }
    });

    state.payments.forEach(payment => {
      if (!repasseByPaymentId.has(payment.id)) {
        // Gera o repasse para os que faltam (ou para os que foram apagados no bloco acima para atualizar data)
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

  const metrics = useMemo(() => {
    const now = new Date();
    const monthlyReceived = state.payments
      .filter(p => {
        const d = new Date(p.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, p) => sum + p.amount, 0);

    const monthlyExpenses = (state.expenses || [])
      .filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, e) => sum + e.amount, 0);

    const netProfit = monthlyReceived - monthlyExpenses;
    const activePackages = state.patients.filter(p => p.status === 'Ativo').length;
    
    let totalToReceive = 0;
    state.patients.filter(p => p.status === 'Ativo').forEach(patient => {
      const paid = state.payments.filter(p => p.patientId === patient.id).reduce((s, p) => s + p.amount, 0);
      const pagoNoPacoteAtual = paid % 1000;
      const faltaNoPacoteAtual = pagoNoPacoteAtual === 0 ? 0 : 1000 - pagoNoPacoteAtual;
      totalToReceive += faltaNoPacoteAtual;
    });

    totalToReceive = totalToReceive * 0.8;

    return { monthlyReceived, monthlyExpenses, netProfit, totalToReceive, activePackages };
  }, [state]);

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

  const filteredPatientsFinance = useMemo(() => {
    return state.patients
      .filter(p => p.status === 'Ativo')
      .map(patient => {
        const patientPayments = state.payments.filter(p => p.patientId === patient.id);
        const totalPaid = patientPayments.reduce((sum, p) => sum + p.amount, 0);

        const pacotesCompletos = Math.floor(totalPaid / 1000);
        const pagoNoPacoteAtual = totalPaid % 1000;
        const remaining = pagoNoPacoteAtual === 0 ? 0 : 1000 - pagoNoPacoteAtual;

        let status: 'Quitado' | 'Parcial' | 'Pendente' = 'Pendente';
        if (pagoNoPacoteAtual === 0) status = 'Quitado'; 
        else if (pagoNoPacoteAtual >= 500) status = 'Parcial';
        else status = 'Pendente';

        const sessionCount = state.sessions.filter(s => s.patientId === patient.id && (s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO)).length;
        const sessionsInCurrentPackage = sessionCount % 10 === 0 && sessionCount > 0 ? 10 : sessionCount % 10;
        const isLate = patient.paymentModal === PaymentModal.PARCELADO && sessionsInCurrentPackage >= 6 && pagoNoPacoteAtual < 500;
        
        return { ...patient, totalPaid, remaining, status, isLate, pacotesCompletos, pagoNoPacoteAtual };
      })
      .filter(p => {
        const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        return normalize(p.name).includes(normalize(searchTerm));
      })
      .sort((a,b) => b.isLate ? 1 : -1);
  }, [state, searchTerm]);

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-clinic-surface p-5 rounded-2xl border border-clinic-border shadow-clinic flex flex-col">
          <div className="flex items-center gap-2 mb-1 text-status-green-text">
            <TrendingUp size={16} />
            <p className="text-[10px] uppercase font-bold tracking-widest">Receitas (Mês)</p>
          </div>
          <p className="text-xl font-bold text-clinic-text">{formatCurrency(metrics.monthlyReceived)}</p>
        </div>
        
        <div className="bg-clinic-surface p-5 rounded-2xl border border-clinic-border shadow-clinic flex flex-col">
          <div className="flex items-center gap-2 mb-1 text-status-red-text">
            <TrendingDown size={16} />
            <p className="text-[10px] uppercase font-bold tracking-widest">Despesas (Mês)</p>
          </div>
          <p className="text-xl font-bold text-clinic-text">{formatCurrency(metrics.monthlyExpenses)}</p>
        </div>

        <div className="bg-clinic-surface p-5 rounded-2xl border border-clinic-border shadow-clinic flex flex-col relative overflow-hidden">
          <div className="absolute inset-0 bg-clinic-primary/5 pointer-events-none"></div>
          <div className="flex items-center gap-2 mb-1 text-clinic-primary">
            <Wallet size={16} />
            <p className="text-[10px] uppercase font-bold tracking-widest">Lucro Líquido</p>
          </div>
          <p className="text-xl font-bold text-clinic-text relative z-10">{formatCurrency(metrics.netProfit)}</p>
        </div>

        <div className="bg-clinic-surface p-5 rounded-2xl border border-clinic-border shadow-clinic flex flex-col">
          <div className="flex items-center gap-2 mb-1 text-clinic-text-faint">
            <DollarSign size={16} />
            <p className="text-[10px] uppercase font-bold tracking-widest">Saldo a Receber</p>
          </div>
          <p className="text-xl font-bold text-clinic-text">{formatCurrency(metrics.totalToReceive)}</p>