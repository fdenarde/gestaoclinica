import React, { useState, useMemo, useEffect } from 'react';
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

  // Sincronização e Limpeza Automática (Corrige Duplicatas e Órfãos)
  useEffect(() => {
    if (!state.payments || !state.expenses) return;

    const currentExpenses = state.expenses;
    const expensesToDelete: string[] = [];
    const missingExpenses: Expense[] = [];

    // Mapeia todos os IDs de pagamentos reais que existem agora
    const validPaymentIds = new Set(state.payments.map(p => p.id));
    const repasseByPaymentId = new Map();

    // 1. Identifica órfãos e duplicatas
    currentExpenses.forEach(e => {
      if (e.auto_gerado && e.pagamento_origem_id) {
        if (!validPaymentIds.has(e.pagamento_origem_id)) {
          // ÓRFÃO: O pagamento original foi apagado ou alterado
          expensesToDelete.push(e.id);
        } else if (repasseByPaymentId.has(e.pagamento_origem_id)) {
          // DUPLICADO: Já existe um repasse mapeado para este pagamento
          expensesToDelete.push(e.id);
        } else {
          // VÁLIDO: Guarda o repasse
          repasseByPaymentId.set(e.pagamento_origem_id, e);
        }
      }
    });

    // 2. Verifica se falta algum repasse para os pagamentos válidos
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

    // 3. Atualiza o banco removendo o lixo e inserindo os corretos
    if (expensesToDelete.length > 0 || missingExpenses.length > 0) {
      const updatedExpenses = currentExpenses.filter(e => !expensesToDelete.includes(e.id));
      onUpdate({ expenses: [...updatedExpenses, ...missingExpenses] });
      
      if (expensesToDelete.length > 0) {
        showToast(`${expensesToDelete.length} repasses órfãos/duplicados removidos.`, 'success');
      }
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

    showToast(`Pagamento registrado! Repasse de ${formatCurrency(repasseAmount)} gerado automaticamente.`);
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
    showToast('Despesa registrada com sucesso!');
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