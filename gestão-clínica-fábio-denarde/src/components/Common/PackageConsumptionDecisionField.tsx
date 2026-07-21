interface PackageConsumptionDecisionFieldProps {
  value: boolean | null;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function PackageConsumptionDecisionField({
  value,
  onChange,
  disabled = false,
}: PackageConsumptionDecisionFieldProps) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-black text-clinic-text">
        Esta ausência será contabilizada no pacote?
      </legend>
      <p className="text-xs font-semibold text-clinic-text-muted">
        O motivo da ausência não define o consumo. Selecione uma opção explícita antes de salvar.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          aria-pressed={value === false}
          onClick={() => onChange(false)}
          className={`rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-clinic-primary ${value === false
            ? 'border-clinic-primary bg-clinic-primary/10 ring-1 ring-clinic-primary'
            : 'border-clinic-border bg-white hover:border-clinic-primary/50'}`}
        >
          <span className="block text-sm font-black text-clinic-text">Não contabilizar no pacote</span>
          <span className="mt-1 block text-xs font-semibold text-clinic-text-muted">
            Esta decisão não reduzirá as sessões restantes.
          </span>
        </button>
        <button
          type="button"
          aria-pressed={value === true}
          onClick={() => onChange(true)}
          className={`rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-[#A94444] ${value === true
            ? 'border-[#A94444] bg-[#FFF4F4] ring-1 ring-[#A94444]'
            : 'border-clinic-border bg-white hover:border-[#A94444]/50'}`}
        >
          <span className="block text-sm font-black text-clinic-text">Contabilizar no pacote</span>
          <span className="mt-1 block text-xs font-semibold text-clinic-text-muted">
            Esta decisão consumirá uma sessão do pacote. A ausência não terá atividade, link ou mídia.
          </span>
        </button>
      </div>
      {value === true && (
        <p className="rounded-xl border border-[#A94444]/25 bg-[#FFF4F4] p-3 text-xs font-bold text-[#A94444]">
          Esta decisão consumirá uma sessão do pacote.
        </p>
      )}
    </fieldset>
  );
}
