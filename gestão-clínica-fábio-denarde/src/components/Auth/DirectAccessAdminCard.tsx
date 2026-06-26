import React, { useMemo, useState, type FormEvent } from 'react';
import { Check, Clipboard, Eye, EyeOff, KeyRound, Loader2, UserPlus, X } from 'lucide-react';
import { createDirectAccess } from '../../lib/accessApi';
import type { Patient } from '../../types';
import type { AccessRequestRecord, AccessRequestRole, DirectAccessCredentialsResult } from '../../types/access';

interface DirectAccessAdminCardProps {
  patients: Patient[];
  onCreated: (request: AccessRequestRecord) => void;
}

const EMPTY_FORM = {
  role: 'responsible' as AccessRequestRole,
  displayName: '',
  username: '',
  contactEmail: '',
  phone: '',
  password: '',
  confirmPassword: '',
  expiresAt: '',
  mustChangePassword: true,
};

function roleLabel(role: AccessRequestRole): string {
  if (role === 'responsible') return 'Responsável';
  if (role === 'monitoring') return 'Monitoramento';
  return 'Profissional';
}

export default function DirectAccessAdminCard({ patients, onCreated }: DirectAccessAdminCardProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [linkedPatientIds, setLinkedPatientIds] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DirectAccessCredentialsResult | null>(null);
  const sortedPatients = useMemo(
    () => [...patients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [patients],
  );

  const clearSensitive = () => {
    setForm(current => ({ ...EMPTY_FORM, role: current.role }));
    setLinkedPatientIds([]);
    setShowPassword(false);
  };

  const closeResult = () => {
    setResult(null);
    clearSensitive();
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const togglePatient = (patientId: string) => {
    setLinkedPatientIds(current => current.includes(patientId)
      ? current.filter(id => id !== patientId)
      : current.length < 3 ? [...current, patientId] : current);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    void (async () => {
      setBusy(true);
      try {
        if (form.displayName.trim().length < 3) throw new Error('Informe o nome completo.');
        if (!form.username.trim()) throw new Error('Informe um nome de usuário.');
        if (form.password && (form.password.length < 8 || form.password.length > 72)) {
          throw new Error('A senha temporária deve ter entre 8 e 72 caracteres.');
        }
        if (form.password && (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password))) {
          throw new Error('A senha temporária deve conter letras e números.');
        }
        if (form.password && form.password !== form.confirmPassword) throw new Error('A confirmação da senha temporária não corresponde.');
        if (form.role === 'responsible' && linkedPatientIds.length === 0) {
          throw new Error('Selecione pelo menos um atendente para o Responsável.');
        }

        const created = await createDirectAccess({
          role: form.role,
          displayName: form.displayName.trim(),
          username: form.username.trim(),
          contactEmail: form.contactEmail.trim() || undefined,
          phone: form.phone.trim() || undefined,
          password: form.password,
          linkedPatientIds: form.role === 'responsible' ? linkedPatientIds : [],
          expiresAt: form.expiresAt || null,
          mustChangePassword: form.mustChangePassword,
        });
        setResult(created);
        onCreated(created.request);
        setOpen(false);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível criar o acesso direto.');
      } finally {
        setBusy(false);
      }
    })();
  };

  if (result) {
    const fullLink = `${window.location.origin}${result.accessPath}`;
    return (
      <section className="mb-5 rounded-xl border border-status-green-text/25 bg-status-green-bg p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-status-green-text">Acesso criado com sucesso</p>
            <h3 className="mt-1 text-lg font-black text-clinic-text">Envie estas credenciais ao usuário</h3>
            <p className="mt-1 text-xs text-clinic-text-muted">A senha temporária será apagada desta tela ao fechar este quadro.</p>
          </div>
          <button type="button" onClick={closeResult} className="rounded-lg p-2 text-clinic-text-muted hover:bg-white" aria-label="Fechar credenciais"><X size={18} /></button>
        </div>
        <div className="mt-4 grid gap-3">
          {[
            ['Link', fullLink],
            ['Usuário', result.username],
            ['Senha temporária', result.temporaryPassword],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center gap-3 rounded-xl border border-clinic-border bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-clinic-text-muted">{label}</p>
                <p className="mt-1 break-all font-bold text-clinic-text">{value}</p>
              </div>
              <button type="button" onClick={() => void copy(value)} className="rounded-lg border border-clinic-border p-2 text-clinic-primary hover:bg-clinic-bg" aria-label={`Copiar ${label}`}><Clipboard size={17} /></button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mb-5 rounded-xl border border-status-green-text/25 bg-clinic-surface p-4 shadow-sm">
      <button type="button" onClick={() => setOpen(current => !current)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-3">
          <span className="rounded-xl bg-status-green-bg p-2 text-status-green-text"><UserPlus size={20} /></span>
          <span>
            <span className="block font-black text-clinic-text">Criar acesso direto</span>
            <span className="mt-1 block text-xs text-clinic-text-muted">Cadastre usuário e senha sem solicitação pública.</span>
          </span>
        </span>
        <span className="text-sm font-black text-clinic-primary">{open ? 'Fechar' : 'Abrir'}</span>
      </button>

      {open && (
        <form onSubmit={submit} className="mt-5 space-y-4 border-t border-clinic-border pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">Perfil</span>
              <select className="clinic-input bg-white" value={form.role} onChange={event => { setForm(current => ({ ...current, role: event.target.value as AccessRequestRole })); setLinkedPatientIds([]); }} disabled={busy}>
                <option value="responsible">Responsável</option>
                <option value="professional">Profissional</option>
                <option value="monitoring">Monitoramento</option>
              </select>
            </label>
            <label>
              <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">Nome completo</span>
              <input className="clinic-input bg-white" value={form.displayName} onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))} disabled={busy} required />
            </label>
            <label>
              <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">Nome de usuário</span>
              <input className="clinic-input bg-white" value={form.username} onChange={event => setForm(current => ({ ...current, username: event.target.value }))} autoComplete="off" placeholder="ex.: responsavel.lara" disabled={busy} required />
            </label>
            <label>
              <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">E-mail de contato — opcional</span>
              <input className="clinic-input bg-white" type="email" value={form.contactEmail} onChange={event => setForm(current => ({ ...current, contactEmail: event.target.value }))} disabled={busy} />
              <span className="mt-1 block text-[11px] text-clinic-text-muted">Usado apenas para contato. O acesso direto será feito pelo nome de usuário.</span>
            </label>
            <label>
              <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">WhatsApp — opcional</span>
              <input className="clinic-input bg-white" value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} disabled={busy} />
            </label>
            <label>
              <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">Validade — opcional</span>
              <input className="clinic-input bg-white" type="date" value={form.expiresAt} onChange={event => setForm(current => ({ ...current, expiresAt: event.target.value }))} disabled={busy} />
            </label>
            <label>
              <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">Senha temporária — opcional</span>
              <div className="relative">
                <input className="clinic-input bg-white pr-11" type={showPassword ? 'text' : 'password'} value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} autoComplete="new-password" placeholder="Em branco: gerar automaticamente" disabled={busy} />
                <button type="button" onClick={() => setShowPassword(current => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 text-clinic-text-muted" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            </label>
            <label>
              <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">Confirmar senha</span>
              <input className="clinic-input bg-white" type={showPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={event => setForm(current => ({ ...current, confirmPassword: event.target.value }))} autoComplete="new-password" disabled={busy || !form.password} />
            </label>
          </div>

          {form.role === 'responsible' && (
            <fieldset className="rounded-xl border border-status-blue-text/20 bg-status-blue-bg p-4">
              <legend className="px-2 text-xs font-black uppercase tracking-wider text-status-blue-text">Atendentes autorizados — máximo 3</legend>
              <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                {sortedPatients.map(patient => (
                  <label key={patient.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-clinic-text">
                    <input type="checkbox" checked={linkedPatientIds.includes(patient.id)} onChange={() => togglePatient(patient.id)} disabled={busy || (!linkedPatientIds.includes(patient.id) && linkedPatientIds.length >= 3)} className="h-4 w-4 accent-clinic-primary" />
                    <span className="truncate">{patient.name}</span>
                  </label>
                ))}
              </div>
              {!sortedPatients.length && <p className="mt-2 text-sm text-status-orange-text">Nenhum atendente disponível para vínculo.</p>}
            </fieldset>
          )}

          <label className="flex items-start gap-3 rounded-xl border border-clinic-border bg-clinic-bg p-3 text-sm font-bold text-clinic-text">
            <input type="checkbox" checked={form.mustChangePassword} onChange={event => setForm(current => ({ ...current, mustChangePassword: event.target.checked }))} disabled={busy} className="mt-0.5 h-4 w-4 accent-clinic-primary" />
            <span>Exigir que o usuário crie uma senha particular no primeiro acesso.</span>
          </label>

          {error && <div role="alert" className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-4 py-3 text-sm font-bold text-status-red-text">{error}</div>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => { setOpen(false); clearSensitive(); setError(''); }} disabled={busy} className="rounded-xl border border-clinic-border bg-white px-4 py-3 text-sm font-bold text-clinic-text disabled:opacity-60">Cancelar</button>
            <button type="submit" disabled={busy} className="flex items-center justify-center gap-2 rounded-xl bg-status-green-text px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
              {busy ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
              Criar acesso de {roleLabel(form.role)}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
