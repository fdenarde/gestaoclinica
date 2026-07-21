import { useRef, useState } from 'react';
import Modal from './Modal';
import { PackageConsumptionDecisionField } from './PackageConsumptionDecisionField';

interface PackageConsumptionDecisionModalProps {
  isOpen: boolean;
  value: boolean | null;
  onChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: (value: boolean) => Promise<void>;
  confirmNonConsumption?: boolean;
  title?: string;
}

export function PackageConsumptionDecisionModal({
  isOpen,
  value,
  onChange,
  onClose,
  onConfirm,
  confirmNonConsumption = false,
  title = 'Registrar falta',
}: PackageConsumptionDecisionModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const saveLockRef = useRef(false);

  const handleConfirm = async () => {
    if (value === null || saveLockRef.current) return;
    if (value === true && !window.confirm(
      'Confirmar contabilização desta falta no pacote?\n\nA ausência consumirá uma sessão, mas não terá atividade ou mídia.',
    )) return;
    if (value === false && confirmNonConsumption && !window.confirm(
      'Confirmar que esta falta não será contabilizada no pacote?\n\nA alteração devolverá uma sessão ao saldo restante.',
    )) return;

    saveLockRef.current = true;
    setIsSaving(true);
    try {
      await onConfirm(value);
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width="max-w-xl"
      closeDisabled={isSaving}
    >
      <div className="space-y-5">
        <PackageConsumptionDecisionField value={value} onChange={onChange} disabled={isSaving} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-xl border border-clinic-border bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-clinic-text-muted disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={value === null || isSaving}
            className="rounded-xl bg-clinic-primary px-4 py-3 text-xs font-black uppercase tracking-wide text-white hover:bg-clinic-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Salvando...' : 'Salvar decisão'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
