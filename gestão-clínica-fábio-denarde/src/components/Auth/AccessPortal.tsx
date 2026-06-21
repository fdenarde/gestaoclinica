import React, { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import {
  createEmailAccount,
  loginWithEmail,
  loginWithGoogle,
  logout,
  requestPasswordReset,
} from '../../firebase';
import { submitAccessRequest } from '../../lib/accessApi';
import { applyTheme } from '../../lib/theme';
import type { AccessProfile, AccessRequestInput, AccessRequestRole } from '../../types/access';
import BrandLogo from '../Common/BrandLogo';

type PortalView = 'login' | 'request' | 'reset';

interface AccessPortalProps {
  user: User | null;
  profile: AccessProfile | null;
  profileLoading: boolean;
  profileError: string;
  onAccessRequestSubmitted: (profile: AccessProfile | null) => void;
  onRetryProfile: () => void;
  onLogout?: () => Promise<void> | void;
}

const EMPTY_REQUEST: AccessRequestInput = {
  displayName: '',
  email: '',
  phone: '',
  role: 'professional',
  linkedPatientName: '',
  notes: '',
};

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function accessRoleLabel(role: AccessProfile['role']): string {
  if (role === 'admin') return 'Administrador';
  if (role === 'professional') return 'Profissional';
  if (role === 'responsible') return 'Responsável';
  return 'Monitoramento';
}

function statusCopy(profile: AccessProfile): { title: string; description: string; tone: string } {
  if (profile.status === 'approved' && profile.role === 'responsible') {
    return {
      title: 'Acesso aprovado',
      description: 'Seu acesso ao Portal do Responsável está autorizado.',
      tone: 'text-status-blue-text bg-status-blue-bg',
    };
  }
  if (profile.status === 'approved' && profile.role === 'monitoring') {
    return {
      title: 'Perfil de Monitoramento configurado',
      description: 'O painel de Monitoramento permanece indisponível até a conclusão e validação da etapa de segurança.',
      tone: 'text-status-blue-text bg-status-blue-bg',
    };
  }
  if (profile.status === 'rejected') {
    return {
      title: 'Acesso não autorizado',
      description: 'Sua solicitação foi analisada, mas o acesso não foi autorizado. Entre em contato com a clínica para mais informações.',
      tone: 'text-status-red-text bg-status-red-bg',
    };
  }
  if (['revoked', 'disabled', 'canceled'].includes(profile.status)) {
    return {
      title: profile.status === 'revoked' ? 'Acesso revogado' : 'Acesso desativado',
      description: 'Favor entrar em contato com a clínica responsável.',
      tone: 'text-status-red-text bg-status-red-bg',
    };
  }
  return {
    title: 'Solicitação em análise',
    description: 'Seu acesso está pendente de aprovação administrativa.',
    tone: 'text-status-orange-text bg-status-orange-bg',
  };
}

export default function AccessPortal({
  user,
  profile,
  profileLoading,
  profileError,
  onAccessRequestSubmitted,
  onRetryProfile,
  onLogout,
}: AccessPortalProps) {
  const [view, setView] = useState<PortalView>(user ? 'request' : 'login');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [request, setRequest] = useState<AccessRequestInput>({
    ...EMPTY_REQUEST,
    displayName: user?.displayName || '',
    email: user?.email || '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  useLayoutEffect(() => {
    applyTheme('calm-tech');
  }, []);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email || '');
    setRequest(current => ({
      ...current,
      displayName: current.displayName || user.displayName || '',
      email: user.email || current.email,
    }));
    if (!profile && !profileLoading && !profileError) setView('request');
  }, [profile, profileError, profileLoading, user]);

  const clearFeedback = () => {
    setError('');
    setMessage('');
  };

  const run = async (operation: () => Promise<void>) => {
    clearFeedback();
    setBusy(true);
    try {
      await operation();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailLogin = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await loginWithEmail(email, password);
    });
  };

  const handleGoogleLogin = () => {
    void run(async () => {
      await loginWithGoogle();
    });
  };

  const handleResetPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!email.trim()) throw new Error('Informe seu e-mail para receber o link de recuperação.');
      await requestPasswordReset(email);
      setMessage('Enviamos as instruções de recuperação. Verifique também a caixa de spam.');
    });
  };

  const handleRequestChange = (field: keyof AccessRequestInput, value: string) => {
    setRequest(current => ({ ...current, [field]: field === 'phone' ? normalizePhone(value) : value }));
  };

  const handleAccessRequest = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const normalized: AccessRequestInput = {
        ...request,
        displayName: request.displayName.trim(),
        email: (user?.email || request.email).trim().toLowerCase(),
        phone: request.phone.trim(),
        linkedPatientName: request.linkedPatientName.trim(),
        notes: request.notes.trim(),
      };

      if (normalized.displayName.length < 3) throw new Error('Informe seu nome completo.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) throw new Error('Informe um e-mail válido.');
      if (!/^\d{10,11}$/.test(normalized.phone.replace(/\D/g, ''))) {
        throw new Error('Informe um telefone com DDD.');
      }
      if (normalized.role === 'responsible' && normalized.linkedPatientName.length < 2) {
        throw new Error('Informe o nome do paciente ou atendente vinculado.');
      }

      let authenticatedUser = user;
      let createdEmailAccount = false;
      if (!authenticatedUser) {
        if (password.length < 6) throw new Error('Crie uma senha com pelo menos 6 caracteres.');
        if (!confirmPassword) throw new Error('Confirme a senha criada.');
        if (password !== confirmPassword) throw new Error('As senhas informadas não coincidem.');

        const credential = await createEmailAccount({
          displayName: normalized.displayName,
          email: normalized.email,
          password,
        });
        authenticatedUser = credential.user;
        createdEmailAccount = true;
      }

      const result = await submitAccessRequest(normalized, authenticatedUser);
      onAccessRequestSubmitted(result.profile);
      setRequestSubmitted(true);
      setMessage('Cadastro enviado com sucesso. Aguarde a aprovação da administração.');
      setPassword('');
      setConfirmPassword('');
      if (createdEmailAccount) await logout();
    });
  };

  const handleLogout = () => {
    void run(async () => {
      await (onLogout ? onLogout() : logout());
      setView('login');
      setPassword('');
      setConfirmPassword('');
    });
  };

  const renderFeedback = () => (
    <>
      {error && (
        <div role="alert" className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-4 py-3 text-sm font-medium text-status-red-text">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-xl border border-status-green-text/20 bg-status-green-bg px-4 py-3 text-sm font-medium text-status-green-text">
          {message}
        </div>
      )}
    </>
  );

  const renderLogin = () => (
    <form onSubmit={handleEmailLogin} className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-clinic-primary">Acesso seguro</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-clinic-text">Entre na plataforma</h1>
        <p className="mt-2 text-sm leading-relaxed text-clinic-text-muted">
          Use sua conta aprovada para acessar agenda, atendimentos e gestão clínica.
        </p>
      </div>

      {renderFeedback()}

      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">E-mail</span>
        <div className="relative">
          <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-clinic-text-faint" />
          <input
            className="clinic-input pl-11"
            type="email"
            autoComplete="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            required
          />
        </div>
      </label>

      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">Senha</span>
        <div className="relative">
          <KeyRound className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-clinic-text-faint" />
          <input
            className="clinic-input px-11"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(current => !current)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-clinic-text-faint hover:text-clinic-primary"
            aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </label>

      <div className="flex items-center justify-between gap-4 text-sm">
        <button type="button" onClick={() => { clearFeedback(); setView('reset'); }} className="font-semibold text-clinic-primary hover:underline">
          Esqueci minha senha
        </button>
        <button type="button" onClick={() => { clearFeedback(); setView('request'); }} className="font-semibold text-clinic-primary hover:underline">
          Criar acesso
        </button>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3.5 font-bold text-white shadow-md transition hover:bg-clinic-primary-hover disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? <Loader2 size={19} className="animate-spin" /> : <LockKeyhole size={19} />}
        Entrar com e-mail
      </button>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-clinic-text-faint">
        <span className="h-px flex-1 bg-clinic-border" />
        ou
        <span className="h-px flex-1 bg-clinic-border" />
      </div>

      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={busy}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-clinic-border bg-white px-4 py-3.5 font-bold text-clinic-text shadow-sm transition hover:border-clinic-primary hover:bg-clinic-bg disabled:cursor-wait disabled:opacity-60"
      >
        <Mail size={19} className="text-clinic-primary" />
        Entrar com Google
      </button>
    </form>
  );

  const renderReset = () => (
    <form onSubmit={handleResetPassword} className="space-y-5">
      <button type="button" onClick={() => { clearFeedback(); setView('login'); }} className="flex items-center gap-2 text-sm font-semibold text-clinic-primary hover:underline">
        <ArrowLeft size={16} />
        Voltar ao login
      </button>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-clinic-primary">Recuperação</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-clinic-text">Redefina sua senha</h1>
        <p className="mt-2 text-sm leading-relaxed text-clinic-text-muted">
          Informe seu e-mail e enviaremos um link seguro de recuperação.
        </p>
      </div>
      {renderFeedback()}
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">E-mail</span>
        <input
          className="clinic-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3.5 font-bold text-white hover:bg-clinic-primary-hover disabled:opacity-60">
        {busy ? <Loader2 size={19} className="animate-spin" /> : <Mail size={19} />}
        Enviar link de recuperação
      </button>
    </form>
  );

  const renderRequest = () => (
    <form onSubmit={handleAccessRequest} className="space-y-4">
      {!user && (
        <button type="button" onClick={() => { clearFeedback(); setView('login'); }} className="flex items-center gap-2 text-sm font-semibold text-clinic-primary hover:underline">
          <ArrowLeft size={16} />
          Voltar ao login
        </button>
      )}
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-clinic-primary">Novo cadastro</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-clinic-text">Solicitar acesso</h1>
        <p className="mt-2 text-sm leading-relaxed text-clinic-text-muted">
          O cadastro será analisado antes de qualquer acesso aos dados internos.
        </p>
      </div>
      {renderFeedback()}

      {requestSubmitted ? (
        <div className="rounded-2xl border border-status-green-text/20 bg-status-green-bg p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-status-green-text" />
          <h2 className="mt-4 text-xl font-bold text-clinic-text">Solicitação recebida</h2>
          <p className="mt-2 text-sm leading-relaxed text-clinic-text-muted">
            Você será liberado somente após a aprovação do administrador.
          </p>
          {!user && (
            <button
              type="button"
              onClick={() => { clearFeedback(); setView('login'); }}
              className="mt-5 font-semibold text-clinic-primary hover:underline"
            >
              Voltar ao login
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">Nome completo</span>
          <input className="clinic-input" autoComplete="name" value={request.displayName} onChange={event => handleRequestChange('displayName', event.target.value)} required />
        </label>
        <label>
          <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">E-mail</span>
          <input className="clinic-input disabled:opacity-70" type="email" autoComplete="email" value={user?.email || request.email} onChange={event => handleRequestChange('email', event.target.value)} disabled={!!user} required />
        </label>
        <label>
          <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">Telefone / WhatsApp</span>
          <input className="clinic-input" type="tel" autoComplete="tel" value={request.phone} onChange={event => handleRequestChange('phone', event.target.value)} required />
        </label>
        <label>
          <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">Tipo de acesso</span>
          <select className="clinic-input" value={request.role} onChange={event => handleRequestChange('role', event.target.value as AccessRequestRole)}>
            <option value="professional">Profissional</option>
            <option value="responsible">Responsável</option>
          </select>
        </label>
        {request.role === 'responsible' && (
          <label>
            <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">Paciente / atendente vinculado</span>
            <input className="clinic-input" value={request.linkedPatientName} onChange={event => handleRequestChange('linkedPatientName', event.target.value)} required />
          </label>
        )}
        {!user && (
          <>
            <label>
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">Criar senha</span>
              <input
                className="clinic-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                minLength={6}
                required
              />
            </label>
            <label>
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">Confirmar senha</span>
              <input
                className="clinic-input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                minLength={6}
                required
              />
            </label>
          </>
        )}
        <label className="sm:col-span-2">
          <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-clinic-text-muted">Observações opcionais</span>
          <textarea className="clinic-input min-h-24 resize-y" value={request.notes} onChange={event => handleRequestChange('notes', event.target.value)} maxLength={1000} />
        </label>
          </div>

          <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3.5 font-bold text-white hover:bg-clinic-primary-hover disabled:opacity-60">
            {busy ? <Loader2 size={19} className="animate-spin" /> : <UserPlus size={19} />}
            Enviar solicitação
          </button>
        </>
      )}
      {user && (
          <button type="button" onClick={handleLogout} disabled={busy} className="w-full text-sm font-semibold text-clinic-text-muted hover:text-clinic-primary">
            Sair desta conta
          </button>
        )}
    </form>
  );

  const renderBlockedProfile = () => {
    if (!profile) return null;
    const copy = statusCopy(profile);
    return (
      <div className="space-y-6 text-center">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${copy.tone}`}>
          {profile.status === 'pending' ? <Loader2 size={30} className="animate-spin" /> : <ShieldCheck size={30} />}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-clinic-primary">Controle de acesso</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-clinic-text">{copy.title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-clinic-text-muted">{copy.description}</p>
        </div>
        <div className="rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-left text-sm">
          <p className="font-bold text-clinic-text">{profile.displayName || user?.displayName || 'Usuário'}</p>
          <p className="mt-1 text-clinic-text-muted">{profile.email}</p>
          <p className="mt-2 text-xs font-bold uppercase tracking-wider text-clinic-text-faint">
            Perfil: {accessRoleLabel(profile.role)}
          </p>
        </div>
        {message && (
          <div role="status" className="rounded-xl bg-status-green-bg px-4 py-3 text-sm font-medium text-status-green-text">
            {message}
          </div>
        )}
        <button type="button" onClick={handleLogout} disabled={busy} className="w-full rounded-xl border border-clinic-border px-4 py-3 font-bold text-clinic-text hover:border-clinic-primary hover:bg-clinic-bg disabled:opacity-60">
          Sair
        </button>
      </div>
    );
  };

  const renderProfileState = () => {
    if (!user) return view === 'request' ? renderRequest() : view === 'reset' ? renderReset() : renderLogin();
    if (profileLoading) {
      return (
        <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-clinic-primary" />
          <div>
            <h1 className="text-2xl font-bold text-clinic-text">Verificando autorização</h1>
            <p className="mt-2 text-sm text-clinic-text-muted">Aguarde enquanto confirmamos seu perfil de acesso.</p>
          </div>
        </div>
      );
    }
    if (profileError) {
      return (
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-status-red-bg text-status-red-text">
            <LockKeyhole size={30} />
          </div>
          <h1 className="text-3xl font-bold text-clinic-text">Não foi possível validar o acesso</h1>
          <p className="text-sm leading-relaxed text-clinic-text-muted">{profileError}</p>
          <button type="button" onClick={onRetryProfile} className="w-full rounded-xl bg-clinic-primary px-4 py-3 font-bold text-white hover:bg-clinic-primary-hover">
            Tentar novamente
          </button>
          <button type="button" onClick={handleLogout} className="w-full text-sm font-semibold text-clinic-text-muted hover:text-clinic-primary">
            Sair desta conta
          </button>
        </div>
      );
    }
    if (profile) return renderBlockedProfile();
    return renderRequest();
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-clinic-bg px-4 py-6 sm:px-6 lg:flex lg:items-center lg:py-10">
      <div className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full bg-clinic-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-clinic-header/10 blur-3xl" />

      <div className="relative mx-auto grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-clinic-border bg-clinic-surface shadow-2xl lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="relative hidden min-h-[680px] overflow-hidden bg-clinic-header p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_38%)]" />
          <div className="relative">
            <BrandLogo name="Denarde Soluções" subtitle="Gestão Clínica e Acompanhamento" />
          </div>
          <div className="relative max-w-sm">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/65">Gestão Clínica e Acompanhamento</p>
            <h2 className="mt-4 text-4xl font-bold leading-tight">Cuidado clínico com organização e segurança.</h2>
            <p className="mt-5 text-sm leading-relaxed text-white/75">
              O acesso aos dados da clínica é individual, autenticado e liberado somente após aprovação.
            </p>
            <div className="mt-8 space-y-3 text-sm font-medium text-white/85">
              <p className="flex items-center gap-3"><CheckCircle2 size={18} className="text-white" /> Identidade de acesso protegida</p>
              <p className="flex items-center gap-3"><CheckCircle2 size={18} className="text-white" /> Aprovação administrativa obrigatória</p>
              <p className="flex items-center gap-3"><CheckCircle2 size={18} className="text-white" /> Dados internos protegidos antes da liberação</p>
            </div>
          </div>
          <p className="relative text-xs text-white/55">Denarde Soluções • Gestão Clínica</p>
        </aside>

        <main className="max-h-[calc(100vh-3rem)] overflow-y-auto p-6 sm:p-10 lg:max-h-[760px] lg:p-12">
          <div className="mb-8 rounded-2xl bg-clinic-header p-4 lg:hidden">
            <BrandLogo variant="compact" name="Denarde Soluções" subtitle="Gestão Clínica e Acompanhamento" className="justify-center" />
          </div>
          <div className="mx-auto w-full max-w-lg">{renderProfileState()}</div>
        </main>
      </div>
    </div>
  );
}
