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

  // Sincronização e Limpeza Automática com Bloqueio (useRef)
  useEffect(() => {
    if (!state.payments || !state.expenses) return;
    if (syncLock.current) return;

    const currentExpenses = state.expenses;
    const expensesToDelete: string[] = [];
    const missingExpenses: Expense[] = [];

    const validPaymentIds = new Set(state.payments.map(p => p.id));
    const repasseByPaymentId = new Map();

    currentExpenses.forEach(e => {
      if (e.auto_gerado && e.pagamento_origem_id) {
        if (!validPaymentIds.has(e.pagamento_origem_id)) {
          expensesToDelete.push(e.id);
        } else if (repasseByPaymentId.has(e.pagamento_origem_id)) {
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
        showToast(`${expensesToDelete.length} repasses órfãos/duplicados removidos.`, 'success');
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
    setPatientId