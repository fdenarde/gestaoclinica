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

  // Sincronização Retroativa Automática de Repasses da Sócia
  useEffect(() => {
    // Apenas aborta se NÃO houver pagamentos registrados
    if (!state.payments || state.payments.length === 0) return;

    const currentExpenses = state.expenses || [];
    const missingExpenses: Expense[] = [];

    state.payments.forEach(payment => {
      // Verifica se já existe uma despesa de repasse atrelada a este pagamento específico
      const alreadyHasRepasse = currentExpenses.some(
        e => e.pagamento_origem_id === payment.id && e.category === 'Repasse Sócia'
      );

      if (!alreadyHasRepasse) {
        const patientName = state.patients?.find(p => p.id === payment.patientId)?.name || 'Atendente Desconhecido';
        missingExpenses.push({
          id: Math.random().toString(36).substr(2, 9) + Date.now().toString(36),
          description: `Repasse Sócia - ${patientName}`,
          amount: payment.amount * 0.2, // Calcula 20% do pagamento
          date: payment.date, // Registra EXATAMENTE no mesmo período/mês do pagamento original
          category: 'Repasse Sócia',
          auto_gerado: true,
          pagamento_origem_id: payment.id,
        });
      }
    });

    // Se encontrou pagamentos antigos sem o repasse, salva no banco automaticamente
    if (missingExpenses.length > 0) {
      onUpdate({ expenses: [...currentExpenses, ...missingExpenses] });
      // Exibe um aviso visual para você saber que rodou
      showToast(`${missingExpenses.length} repasses retroativos foram sincronizados automaticamente.`, 'success');
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
      // Quanto falta no pacote atual (se múltiplo exato de 1000, pacote quitado = falta 0)
      const pagoNoPacoteAtual = paid % 1000;
      const faltaNoPacoteAtual = pagoNoPacoteAtual === 0 ? 0 : 1000 - pagoNoPacoteAtual;
      totalToReceive += faltaNoPacoteAtual;
    });

    // Desconta 20% do saldo a receber (repasse futuro da sócia)
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

    // Repasse automático de 20% para a sócia
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
        const patientPayments = state.payments.filter(p => p.patientId === patient.id && !state.expenses?.some(e => e.auto_gerado && e.pagamento_origem_id === p.id));
        const totalPaid = patientPayments.reduce((sum, p) => sum + p.amount, 0);

        // Quantos pacotes completos de R$1.000 foram pagos
        const pacotesCompletos = Math.floor(totalPaid / 1000);
        // Quanto foi pago no pacote atual (o que sobra após os pacotes completos)
        const pagoNoPacoteAtual = totalPaid % 1000;
        // Quanto falta para quitar o pacote atual
        const remaining = pagoNoPacoteAtual === 0 ? 0 : 1000 - pagoNoPacoteAtual;

        // Status baseado apenas no pagamento do pacote atual
        let status: 'Quitado' | 'Parcial' | 'Pendente' = 'Pendente';
        if (pagoNoPacoteAtual === 0) status = 'Quitado'; // pacote atual quitado (múltiplo exato de 1000)
        else if (pagoNoPacoteAtual >= 500) status = 'Parcial';
        else status = 'Pendente';

        // Sessões para verificar atraso
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
      {/* Metrics Row */}
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
          <p className="text-[10px] text-clinic-text-faint mt-1">Já descontado repasse da sócia</p>
        </div>
      </div>

      {/* Tabs & Actions */}
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
              <h2 className="font-serif text-xl font-bold">Situação por Atendente</h2>
            </div>
            <div className="p-6 space-y-4">
              {filteredPatientsFinance.map(item => (
                <div key={item.id} className={cn("p-4 rounded-xl border transition-all flex flex-col md:flex-row items-center gap-4", item.isLate ? "bg-status-red-bg border-red-200" : "bg-white border-clinic-border hover:bg-clinic-bg/40")}>
                  <div className="flex-1 w-full text-center md:text-left">
                    <div className="flex flex-col md:flex-row md:items-center gap-2">
                      <h4 className="font-bold text-clinic-text">{item.name}</h4>
                      <span className="text-[10px] text-clinic-text-faint font-bold uppercase px-2 py-0.5 bg-clinic-bg rounded">{item.paymentModal.split(': ')[0]}</span>
                      {item.isLate && <span className="text-[10px] font-black uppercase text-status-red-text animate-pulse">⚠️ Pagamento em Atraso</span>}
                    </div>
                    <div className="text-xs text-clinic-text-muted mt-1">
                      Pacote atual: <span className="font-bold text-clinic-text">{formatCurrency(item.pagoNoPacoteAtual)} / R$ 1.000</span>
                      {item.pacotesCompletos > 0 && <span className="ml-2 px-1.5 py-0.5 bg-clinic-bg rounded text-[10px] text-clinic-text-faint">{item.pacotesCompletos}º pacote concluído</span>}
                    </div>
                    <div className="text-xs text-clinic-text-muted mt-0.5">Falta no pacote atual: <span className="font-bold text-clinic-text">{formatCurrency(item.remaining)}</span></div>
                  </div>
                  <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end">
                    <div className="flex flex-col items-end">
                       <span className="text-xs font-bold text-clinic-text-faint uppercase">Total Histórico</span>
                       <span className="text-base font-bold text-clinic-text">{formatCurrency(item.totalPaid)}</span>
                    </div>
                    <div className={cn("px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest", getStatusColor(item.status))}>{item.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm">
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
                  {state.payments.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(p => (
                    <tr key={p.id} className="hover:bg-clinic-bg/30 transition-colors group">
                      <td className="px-6 py-4 text-sm whitespace-nowrap">{safeFormatDate(p.date, 'dd/MM/yyyy')}</td>
                      <td className="px-6 py-4 text-sm font-bold text-clinic-text">{state.patients.find(pt => pt.id === p.patientId)?.name}</td>
                      <td className="px-6 py-4 text-xs">{p.installment}</td>
                      <td className="px-6 py-4"><span className="px-2 py-1 bg-clinic-bg rounded text-[10px] font-bold text-clinic-text-muted">{p.method}</span></td>
                      <td className="px-6 py-4 text-right text-sm font-bold text-status-green-text flex items-center justify-end gap-3">
                        {formatCurrency(p.amount)}
                        <button onClick={() => setPaymentToDelete(p.id)} className="p-1.5 text-status-red-text bg-status-red-bg rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {state.payments.length === 0 && <p className="py-10 text-center text-clinic-text-muted italic text-sm">Nenhum pagamento registrado.</p>}
            </div>
          </div>
        </div>
      )}

      {viewMode === 'Despesas' && (
        <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm">
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
                {(state.expenses || []).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(e => (
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
              </tbody>
            </table>
            {(!state.expenses || state.expenses.length === 0) && <p className="py-10 text-center text-clinic-text-muted italic text-sm">Nenhuma despesa registrada.</p>}
          </div>
        </div>
      )}

      {/* Modals para Pagamentos */}
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

      {/* Modals para Despesas */}
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