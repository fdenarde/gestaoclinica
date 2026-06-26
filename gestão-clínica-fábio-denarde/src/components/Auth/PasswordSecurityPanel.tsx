import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { Eye, EyeOff, KeyRound, Loader2, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import { changeCurrentUserPassword } from '../../firebase';
import { completePasswordChange } from '../../lib/accessApi';
import type { AccessProfile } from '../../types/access';
import BrandLogo from '../Common/BrandLogo';
import Modal from '../Common/Modal';

interface PasswordSecurityPanelProps {
  user: User;
  profile: AccessProfile;
  required?: boolean;
  onProfileUpdated: (profile: AccessProfile) => void;
  onLogout: () => Promise<void> | void;
}

function accountLabel(profile: AccessProfile): string {
  return profile.username || profile.contactEmail || profile.email || profile.displayName || 'Sua conta';
}

export default function PasswordSecurityPanel({
  user,
  profile,
  required = false,
  onProfileUpdated,
  onLogout,
}: PasswordSecurityPanelProps) {
  const [open, setOpen] = useState(required);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [passwordUpdatedLocally, setPasswordUpdatedLocally] = useState(false);
  const currentPasswordRef = useRef<HTMLInputElement | null>(null);

  const supportsPassword = profile.directAccess === true
    || user.providerData.some(provider => provider.providerId === 'password');

  useEffect(() => {
    if (required) setOpen(true);
  }, [required]);

  const clearSensitiveFields = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords(false);
    setPasswordUpdatedLocally(false);
  };

  const close = () => {
    if (busy || required) return;
    clearSensitiveFields();
    setError('');
    setMessage('');
    setOpen(false);
  };

  const finishProfileUpdate = async () => {
    await user.getIdToken(true);
    const updatedProfile = await completePasswordChange(profile.role, user);
    await user.getIdToken(true);
    onProfileUpdated(updatedProfile);
    setMessage('Senha alterada com sucesso. Use a nova senha nos próximos acessos.');
    clearSensitiveFields();
    if (!required) setOpen(false);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setMessage('');

    void (async () => {
      setBusy(true);
      try {
        if (passwordUpdatedLocally) {
          await finishProfileUpdate();
          return;
        }
        if (!currentPassword) throw new Error('Informe a senha atual.');
        if (newPassword.length < 8) throw new Error('Crie uma nova senha com pelo menos 8 caracteres.');
        if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
          throw new Error('A nova senha deve conter letras e números.');
        }
        if (newPassword === currentPassword) throw new Error('A nova senha deve ser diferente da senha atual.');
        if (newPassword !== confirmPassword) throw new Error('A confirmação não corresponde à nova senha.');

        await changeCurrentUserPassword(currentPassword, newPassword);
        setPasswordUpdatedLocally(true);
        await finishProfileUpdate();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível alterar a senha.');
      } finally {
        setBusy(false);
      }
    })();
  };

  const form = (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-xl border border-clinic-border bg-clinic-bg p-4">
        <p className="text-xs font-black uppercase tracking-wider text-clinic-primary">Conta autenticada</p>
        <p className="mt-2 font-bold text-clinic-text">{profile.displayName}</p>
        <p className="mt-1 break-all text-sm text-clinic-text-muted">{accountLabel(profile)}</p>
      </div>

      {passwordUpdatedLocally ? (
        <div className="rounded-xl border border-status-orange-text/25 bg-status-orange-bg p-4 text-sm text-status-orange-text">
          A senha já foi atualizada no serviço de autenticação. Clique novamente para concluir a atualização do perfil de acesso.
        </div>
      ) : (
        <>
          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">Senha atual</span>
            <div className="relative">
              <KeyRound className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-clinic-text-faint" />
              <input
                ref={currentPasswordRef}
                className="clinic-input px-11"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={event => setCurrentPassword(event.target.value)}
                disabled={busy}
                required
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">Nova senha</span>
            <div className="relative">
              <LockKeyhole className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-clinic-text-faint" />
              <input
                className="clinic-input px-11"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                minLength={8}
                disabled={busy}
                required
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">Confirmar nova senha</span>
            <div className="relative">
              <ShieldCheck className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-clinic-text-faint" />
              <input
                className="clinic-input px-11"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                minLength={8}
                disabled={busy}
                required
              />
            </div>
          </label>

          <button
            type="button"
            onClick={() => setShowPasswords(current => !current)}
            className="flex items-center gap-2 text-sm font-bold text-clinic-primary hover:underline"
          >
            {showPasswords ? <EyeOff size={17} /> : <Eye size={17} />}
            {showPasswords ? 'Ocultar senhas' : 'Mostrar senhas'}
          </button>
        </>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-4 py-3 text-sm font-bold text-status-red-text">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-xl border border-status-green-text/20 bg-status-green-bg px-4 py-3 text-sm font-bold text-status-green-text">
          {message}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {!required && (
          <button type="button" onClick={close} disabled={busy} className="rounded-xl border border-clinic-border bg-white px-4 py-3 text-sm font-bold text-clinic-text disabled:opacity-60">
            Cancelar
          </button>
        )}
        <button type="submit" disabled={busy} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
          {busy ? <Loader2 size={17} className="animate-spin" /> : <KeyRound size={17} />}
          {passwordUpdatedLocally ? 'Concluir atualização' : 'Alterar senha'}
        </button>
      </div>
    </form>
  );

  if (required) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-clinic-bg p-4">
        <section className="w-full max-w-xl rounded-3xl border border-clinic-border bg-clinic-surface p-6 shadow-2xl sm:p-8">
          <BrandLogo variant="horizontal" theme="health-balance" name="Denarde Soluções" subtitle="Segurança da conta" />
          <div className="mt-7">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-clinic-primary">Primeiro acesso</p>
            <h1 className="mt-2 text-3xl font-black text-clinic-text">Crie sua senha particular</h1>
            <p className="mt-2 text-sm leading-relaxed text-clinic-text-muted">
              A senha recebida é temporária. Defina uma nova senha antes de acessar os dados do sistema.
            </p>
          </div>
          <div className="mt-6">{form}</div>
          <button type="button" onClick={() => void onLogout()} disabled={busy} className="mt-5 flex w-full items-center justify-center gap-2 text-sm font-bold text-clinic-text-muted hover:text-clinic-primary disabled:opacity-60">
            <LogOut size={17} />
            Sair desta conta
          </button>
        </section>
      </div>
    );
  }

  if (!supportsPassword) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setError(''); setMessage(''); }}
        className="fixed bottom-4 left-4 z-[210] flex items-center gap-2 rounded-xl border border-clinic-border bg-clinic-surface px-4 py-3 text-xs font-black uppercase text-clinic-primary shadow-lg transition hover:border-clinic-primary hover:bg-clinic-bg"
      >
        <KeyRound size={17} />
        Minha conta
      </button>
      <Modal
        isOpen={open}
        onClose={close}
        title="Segurança da conta"
        width="max-w-xl"
        closeDisabled={busy}
        initialFocusRef={currentPasswordRef}
      >
        {form}
      </Modal>
    </>
  );
}
