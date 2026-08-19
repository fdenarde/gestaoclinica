import { useState } from 'react';
import Modal from './Modal';
import { formatCurrency } from '../../lib/utils';
import { normalizePatientPackageContractValue, type PackageFinancialSummary } from '../../lib/financePackages';

interface PackageContractEditorProps {
  isOpen: boolean;
  patientName: string;
  packageNumber: number;
  currentContract: PackageFinancialSummary['packageContract'];
  receivedAmount: number;
  isSaving?: boolean;
  onClose: () => void;
  onSave: (value: number) => Promise<void> | void;
}

export default function PackageContractEditor({
  isOpen,
  patientName,
  packageNumber,
  currentContract,
  receivedAmount,
  isSaving = false,
  onClose,
  onSave,
}: PackageContractEditorProps) {
  const [valueInput, setValueInput] = useState(
    currentContract.source === 'explicit' ? String(currentContract.contractValue) : '',
  );
  const [error, setError] = useState('');

  const handleSave = async () => {
    const normalizedValue = normalizePatientPackageContractValue(valueInput);
    if (!valueInput.trim() || !normalizedValue) {
      setError('Informe um valor contratado finito e maior que zero.');
      return;
    }
    if (normalizedValue < receivedAmount) {
      setError(`O valor contratado não pode ser menor que os pagamentos existentes de ${formatCurrency(receivedAmount)}.`);
      return;
    }
    if (!window.confirm(
      `${currentContract.source === 'explicit' ? 'Alterar' : 'Definir'} o valor contratado do Pacote ${packageNumber} de ${patientName} para ${formatCurrency(normalizedValue)}? Os pagamentos, sessões e despesas existentes serão preservados.`,
    )) return;

    setError('');
    try {
      await onSave(normalizedValue);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível gravar o valor contratado.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${currentContract.source === 'explicit' ? 'Alterar' : 'Definir'} valor contratado`}
      width="max-w-md"
      closeDisabled={isSaving}
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-clinic-border bg-clinic-bg/70 px-4 py-3 text-sm text-clinic-text-muted">
          <p className="font-black text-clinic-text">{patientName} · Pacote {packageNumber}</p>
          <p className="mt-1">
            {currentContract.source === 'explicit'
              ? <>Valor explícito atual: <span className="font-black text-clinic-text">{formatCurrency(currentContract.contractValue)}</span>.</>
              : <>Valor contratado não registrado. O cálculo legado atual usa <span className="font-black text-clinic-text">{formatCurrency(currentContract.contractValue)}</span> apenas como fallback operacional.</>}
          </p>
          <p className="mt-1">Pagamentos preservados já recebidos: <span className="font-black text-clinic-text">{formatCurrency(receivedAmount)}</span>.</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="package-contract-value" className="text-sm font-bold text-clinic-text-faint">Valor contratado do pacote (R$)</label>
          <input
            id="package-contract-value"
            type="number"
            min="0.01"
            step="0.01"
            value={valueInput}
            onChange={event => {
              setValueInput(event.target.value);
              setError('');
            }}
            disabled={isSaving}
            autoFocus
            className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-clinic-primary disabled:cursor-not-allowed disabled:opacity-70"
          />
          <p className="text-xs text-clinic-text-muted">O valor não pode ser inferior ao total já recebido neste pacote.</p>
        </div>

        {error && <p className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-3 py-2 text-sm font-bold text-status-red-text" role="alert">{error}</p>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={isSaving} className="rounded-lg bg-clinic-bg px-4 py-2 text-sm font-bold text-clinic-text-muted transition-colors hover:bg-clinic-border disabled:cursor-not-allowed disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => void handleSave()} disabled={isSaving} className="rounded-lg bg-clinic-primary px-4 py-2 text-sm font-bold text-white shadow-md transition-colors hover:bg-clinic-primary-hover disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? 'Salvando...' : currentContract.source === 'explicit' ? 'Alterar valor' : 'Definir valor'}</button>
        </div>
      </div>
    </Modal>
  );
}
