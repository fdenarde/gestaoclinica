import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clipboard,
  CircleAlert,
  CircleCheck,
  Clock3,
  KeyRound,
  Link2,
  Loader2,
  MailCheck,
  MailWarning,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  UserRoundCheck,
  X,
} from 'lucide-react';
import {
  deleteAccessRegistration,
  linkResponsiblePatient,
  listAccessRequests,
  reactivateAccessRequest,
  resetDirectAccessPassword,
  requestAdditionalAccessInformation,
  reviewAccessRequest,
  revokeAccessRequest,
  suspendAccessRequest,
  updateAccessValidity,
} from '../../lib/accessApi';
import type { Patient } from '../../types';
import type { AccessRequestRecord, AccessRequestStatus } from '../../types/access';
import Modal from '../Common/Modal';
import DirectAccessAdminCard from './DirectAccessAdminCard';
import { showToast } from '../Common/Toast';

type RequestTab = 'pending' | 'information_requested' | 'approved' | 'rejected' | 'revoked';
type AdminActionKind = 'approveMonitoring' | 'requestInformation' | 'suspend' | 'reactivate' | 'validity' | 'revoke' | 'deleteAccess';
type AccessAdminMockActionKind = AdminActionKind | 'approve' | 'reject' | 'linkPatient';

export interface AccessAdminMockActionInput {
  kind: AccessAdminMockActionKind;
  request: AccessRequestRecord;
  expiresAt?: string | null;
  message?: string;
  confirmation?: string;
  patientId?: string;
}

interface AdminActionModalState {
  kind: AdminActionKind;
  request: AccessRequestRecord;
}

const SUSPENSION_REASON_MAX_LENGTH = 500;
const INFORMATION_MESSAGE_MAX_LENGTH = 1200;

const TABS: Array<{ id: RequestTab; label: string }> = [
  { id: 'pending', label: 'Pendentes' },
  { id: 'information_requested', label: 'Informações' },
  { id: 'approved', label: 'Aprovados' },
  { id: 'rejected', label: 'Rejeitados' },
  { id: 'revoked', label: 'Revogados' },
];

const REVOCATION_CONFIRMATION =
  'Tem certeza que deseja revogar este acesso? O histórico será mantido e o usuário não conseguirá entrar até fazer nova solicitação ou ser aprovado novamente.';

function formatDateTime(value: string | null): string {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatDateOnly(value: string | null): string {
  if (!value) return 'Sem prazo';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data inválida';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}

function roleLabel(role: AccessRequestRecord['role']): string {
  if (role === 'responsible') return 'Responsável';
  if (role === 'monitoring') return 'Monitoramento';
  return 'Profissional';
}

function notificationLabel(request: AccessRequestRecord) {
  if (!['approved', 'revoked', 'disabled', 'canceled'].includes(request.status)) return null;
  const prefix = request.status === 'approved' ? '' : 'Antes da revogação: ';
  if (request.emailNotificationStatus === 'sent') {
    return {
      icon: MailCheck,
      label: `${prefix}e-mail de aprovação enviado`,
      className: 'text-status-green-text bg-status-green-bg',
    };
  }
  if (request.emailNotificationStatus === 'failed') {
    return {
      icon: MailWarning,
      label: `${prefix}falha no e-mail de aprovação`,
      className: 'text-status-red-text bg-status-red-bg',
    };
  }
  return {
    icon: MailWarning,
    label: 'E-mail não enviado: serviço não configurado',
    className: 'text-status-orange-text bg-status-orange-bg',
  };
}

function statusBadge(status: AccessRequestRecord['status']) {
  if (status === 'information_requested') {
    return { icon: CircleAlert, label: 'Aguardando informações', className: 'text-status-orange-text bg-status-orange-bg' };
  }
  if (status === 'approved') {
    return { icon: CircleCheck, label: 'Aprovado', className: 'text-status-green-text bg-status-green-bg' };
  }
  if (status === 'rejected') {
    return { icon: CircleAlert, label: 'Rejeitado', className: 'text-status-red-text bg-status-red-bg' };
  }
  if (['revoked', 'disabled', 'canceled'].includes(status)) {
    return { icon: ShieldOff, label: 'Revogado', className: 'text-status-red-text bg-status-red-bg' };
  }
  return { icon: Clock3, label: 'Pendente', className: 'text-status-orange-text bg-status-orange-bg' };
}

function tabForStatus(status: AccessRequestStatus): RequestTab {
  return ['revoked', 'disabled', 'canceled'].includes(status) ? 'revoked' : status as RequestTab;
}

function isSuspended(request: AccessRequestRecord): boolean {
  if (!request.suspendedAt) return false;
  if (!request.reactivatedAt) return true;
  return new Date(request.suspendedAt).getTime() > new Date(request.reactivatedAt).getTime();
}

function isExpired(request: AccessRequestRecord): boolean {
  if (!request.expiresAt) return false;
  const expiresAt = new Date(request.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function validityLabel(request: AccessRequestRecord): string {
  if (!request.expiresAt) return 'Sem prazo';
  return isExpired(request)
    ? `Expirado em ${formatDateOnly(request.expiresAt)}`
    : `Válido até ${formatDateOnly(request.expiresAt)}`;
}

function canDeleteAccessRegistration(request: AccessRequestRecord): boolean {
  return ['rejected', 'revoked', 'disabled', 'canceled'].includes(request.status);
}

function dateInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return value.slice(0, 10);
}

function isValidDateInput(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localNoon = new Date(Date.UTC(year, month - 1, day, 15, 0, 0));
  return localNoon.getUTCFullYear() === year
    && localNoon.getUTCMonth() === month - 1
    && localNoon.getUTCDate() === day;
}

function normalizeModalText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

interface AccessRequestsAdminCardProps {
  patients: Patient[];
  previewRequests?: AccessRequestRecord[];
  previewActiveTab?: RequestTab;
  onPreviewAction?: (input: AccessAdminMockActionInput) => Promise<AccessRequestRecord>;
}

export default function AccessRequestsAdminCard({
  patients,
  previewRequests,
  previewActiveTab,
  onPreviewAction,
}: AccessRequestsAdminCardProps) {
  const [requests, setRequests] = useState<AccessRequestRecord[]>([]);
  const [activeTab, setActiveTab] = useState<RequestTab>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewingId, setReviewingId] = useState('');
  const [linkingId, setLinkingId] = useState('');
  const [patientSelections, setPatientSelections] = useState<Record<string, string>>({});
  const [actionModal, setActionModal] = useState<AdminActionModalState | null>(null);
  const [modalText, setModalText] = useState('');
  const [validityMode, setValidityMode] = useState<'none' | 'date'>('none');
  const [validityDate, setValidityDate] = useState('');
  const [modalError, setModalError] = useState('');
  const [resettingId, setResettingId] = useState('');
  const [resetPasswordRequest, setResetPasswordRequest] = useState<AccessRequestRecord | null>(null);
  const [resetCredentials, setResetCredentials] = useState<{ username: string; temporaryPassword: string; accessPath: string } | null>(null);
  const modalPrimaryRef = useRef<HTMLElement | null>(null);
  const actionSubmittingRef = useRef(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    if (previewRequests) {
      setRequests(previewRequests);
      setLoading(false);
      return;
    }
    try {
      setRequests(await listAccessRequests());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar as solicitações.');
    } finally {
      setLoading(false);
    }
  }, [previewRequests]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (!previewRequests) return;
    setRequests(previewRequests);
    setLoading(false);
    setError('');
    if (previewActiveTab) setActiveTab(previewActiveTab);
  }, [previewActiveTab, previewRequests]);

  const visibleRequests = useMemo(
    () => requests.filter(request => tabForStatus(request.status) === activeTab),
    [activeTab, requests],
  );

  const selectablePatients = useMemo(
    () => [...patients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [patients],
  );

  const counts = useMemo(
    () => requests.reduce<Record<RequestTab, number>>(
      (result, request) => {
        const tab = tabForStatus(request.status);
        result[tab] += 1;
        return result;
      },
      { pending: 0, information_requested: 0, approved: 0, rejected: 0, revoked: 0 },
    ),
    [requests],
  );

  const closeActionModal = () => {
    if (reviewingId || actionSubmittingRef.current) return;
    setActionModal(null);
    setModalText('');
    setValidityMode('none');
    setValidityDate('');
    setModalError('');
  };

  const openActionModal = (kind: AdminActionKind, request: AccessRequestRecord) => {
    setModalError('');
    setModalText('');
    setValidityMode(request.expiresAt ? 'date' : 'none');
    setValidityDate(dateInputValue(request.expiresAt));
    setActionModal({ kind, request });
  };

  const runAccessAction = async (input: AccessAdminMockActionInput): Promise<AccessRequestRecord> => {
    if (onPreviewAction) return onPreviewAction(input);
    if (input.kind === 'approve' || input.kind === 'approveMonitoring') {
      return reviewAccessRequest(input.request.id, 'approve', { expiresAt: input.expiresAt ?? null });
    }
    if (input.kind === 'reject') return reviewAccessRequest(input.request.id, 'reject');
    if (input.kind === 'requestInformation') return requestAdditionalAccessInformation(input.request.id, input.message || '');
    if (input.kind === 'suspend') return suspendAccessRequest(input.request.id, input.message || '');
    if (input.kind === 'reactivate') return reactivateAccessRequest(input.request.id);
    if (input.kind === 'validity') return updateAccessValidity(input.request.id, input.expiresAt ?? null);
    if (input.kind === 'linkPatient') return linkResponsiblePatient(input.request.id, input.patientId || '');
    if (input.kind === 'deleteAccess') {
      await deleteAccessRegistration(input.request.id, input.confirmation || '');
      return { ...input.request, status: 'canceled' };
    }
    return revokeAccessRequest(input.request.id);
  };

  const review = async (request: AccessRequestRecord, decision: 'approve' | 'reject', expiresAt: string | null = null) => {
    setReviewingId(request.id);
    try {
      const reviewedRequest = await runAccessAction({ kind: decision, request, expiresAt });
      setRequests(current => current.map(item => item.id === request.id ? reviewedRequest : item));
      showToast(decision === 'approve' ? 'Acesso aprovado.' : 'Solicitação rejeitada.');
    } catch (caughtError) {
      showToast(
        caughtError instanceof Error ? caughtError.message : 'Não foi possível revisar a solicitação.',
        'error',
      );
    } finally {
      setReviewingId('');
    }
  };

  const submitActionModal = async () => {
    if (!actionModal || reviewingId || actionSubmittingRef.current) return;

    const { kind, request } = actionModal;
    const normalizedText = normalizeModalText(modalText);
    const expiresAt = validityMode === 'date' ? validityDate : null;

    if ((kind === 'approveMonitoring' || kind === 'validity') && validityMode === 'date' && !isValidDateInput(validityDate)) {
      setModalError('Informe uma data válida no formato AAAA-MM-DD.');
      return;
    }
    if (kind === 'requestInformation' && !normalizedText) {
      setModalError('Informe a mensagem que será enviada ao solicitante.');
      return;
    }
    if (kind === 'deleteAccess') {
      const expected = `EXCLUIR ${request.role === 'monitoring' ? 'MONITORAMENTO' : request.role === 'responsible' ? 'RESPONSAVEL' : 'PROFISSIONAL'}`;
      if (normalizedText.toUpperCase() !== expected) {
        setModalError(`Digite ${expected} para confirmar.`);
        return;
      }
    }

    actionSubmittingRef.current = true;
    setReviewingId(request.id);
    setModalError('');
    try {
      let updatedRequest: AccessRequestRecord;
      if (kind === 'approveMonitoring') {
        updatedRequest = await runAccessAction({ kind, request, expiresAt });
        showToast('Acesso aprovado.');
      } else if (kind === 'requestInformation') {
        updatedRequest = await runAccessAction({ kind, request, message: normalizedText });
        showToast('Informações adicionais solicitadas.');
      } else if (kind === 'suspend') {
        updatedRequest = await runAccessAction({ kind, request, message: normalizedText });
        showToast('Acesso suspenso.');
      } else if (kind === 'reactivate') {
        updatedRequest = await runAccessAction({ kind, request });
        showToast(isExpired(updatedRequest) ? 'Acesso reativado, mas permanece expirado até renovar a validade.' : 'Acesso reativado.');
      } else if (kind === 'validity') {
        updatedRequest = await runAccessAction({ kind, request, expiresAt });
        showToast(updatedRequest.expiresAt ? 'Validade atualizada.' : 'Validade removida.');
      } else if (kind === 'deleteAccess') {
        updatedRequest = await runAccessAction({ kind, request, confirmation: normalizedText.toUpperCase() });
        showToast(`Cadastro de acesso ${roleLabel(request.role)} excluído. A conta Auth e os demais perfis foram preservados.`);
      } else {
        updatedRequest = await runAccessAction({ kind, request });
        showToast('Acesso revogado. O histórico foi mantido.');
      }
      setRequests(current => kind === 'deleteAccess'
        ? current.filter(item => !(
          item.role === request.role
          && item.email.trim().toLowerCase() === request.email.trim().toLowerCase()
        ))
        : current.map(item => item.id === request.id ? updatedRequest : item));
      setActionModal(null);
      setModalText('');
      setValidityMode('none');
      setValidityDate('');
    } catch (caughtError) {
      setModalError(caughtError instanceof Error ? caughtError.message : 'Não foi possível concluir a ação.');
    } finally {
      actionSubmittingRef.current = false;
      setReviewingId('');
    }
  };

  const submitPasswordReset = async () => {
    const request = resetPasswordRequest;
    if (!request || resettingId || reviewingId) return;
    setResettingId(request.id);
    try {
      const result = await resetDirectAccessPassword(request.id);
      setRequests(current => current.map(item => item.id === result.request.id ? result.request : item));
      setResetCredentials({
        username: result.request.username || request.username || '',
        temporaryPassword: result.temporaryPassword,
        accessPath: request.role === 'responsible' ? '/responsavel' : request.role === 'monitoring' ? '/monitoramento' : '/profissional',
      });
      setResetPasswordRequest(null);
      showToast('Nova senha temporária gerada. Copie antes de fechar o quadro.', 'success');
    } catch (caughtError) {
      showToast(caughtError instanceof Error ? caughtError.message : 'Não foi possível gerar a nova senha temporária.', 'error');
    } finally {
      setResettingId('');
    }
  };

  const linkPatient = async (request: AccessRequestRecord) => {
    const patientId = patientSelections[request.id] || '';
    if (!patientId) {
      showToast('Selecione o paciente que será vinculado ao responsável.', 'error');
      return;
    }

    setLinkingId(request.id);
    try {
      const linkedRequest = await runAccessAction({ kind: 'linkPatient', request, patientId });
      setRequests(current => current.map(item => item.id === request.id ? linkedRequest : item));
      setPatientSelections(current => ({ ...current, [request.id]: '' }));
      showToast('Atendente vinculado ao responsável.');
    } catch (caughtError) {
      showToast(
        caughtError instanceof Error ? caughtError.message : 'Não foi possível vincular o paciente.',
        'error',
      );
    } finally {
      setLinkingId('');
    }
  };

  const actionRequest = actionModal?.request || null;
  const modalBusy = !!actionRequest && reviewingId === actionRequest.id;
  const showValidityFields = actionModal?.kind === 'approveMonitoring' || actionModal?.kind === 'validity';
  const showTextArea = actionModal?.kind === 'requestInformation' || actionModal?.kind === 'suspend' || actionModal?.kind === 'deleteAccess';
  const textAreaMaxLength = actionModal?.kind === 'suspend'
    ? SUSPENSION_REASON_MAX_LENGTH
    : INFORMATION_MESSAGE_MAX_LENGTH;
  const modalTitle = actionModal?.kind === 'approveMonitoring'
    ? 'Definir validade'
    : actionModal?.kind === 'requestInformation'
      ? 'Solicitar mais informações'
      : actionModal?.kind === 'suspend'
        ? 'Suspender acesso'
        : actionModal?.kind === 'reactivate'
          ? 'Reativar acesso'
          : actionModal?.kind === 'validity'
            ? actionRequest && isExpired(actionRequest)
              ? 'Renovar acesso'
              : actionRequest?.expiresAt
                ? 'Alterar validade'
                : 'Definir validade'
            : actionModal?.kind === 'revoke'
              ? 'Revogar acesso'
              : actionModal?.kind === 'deleteAccess'
                ? `Excluir cadastro de ${actionRequest ? roleLabel(actionRequest.role) : 'acesso'}`
              : '';
  const modalSubmitLabel = actionModal?.kind === 'approveMonitoring'
    ? 'Aprovar acesso'
    : actionModal?.kind === 'requestInformation'
      ? 'Enviar solicitação'
      : actionModal?.kind === 'suspend'
        ? 'Suspender acesso'
        : actionModal?.kind === 'reactivate'
          ? 'Reativar acesso'
          : actionModal?.kind === 'validity'
            ? 'Salvar validade'
            : actionModal?.kind === 'deleteAccess'
              ? 'Excluir cadastro'
            : 'Revogar acesso';
  const modalSubmitClass = actionModal?.kind === 'suspend' || actionModal?.kind === 'revoke' || actionModal?.kind === 'deleteAccess'
    ? 'bg-status-red-text hover:bg-red-700'
    : actionModal?.kind === 'requestInformation'
      ? 'bg-status-orange-text hover:opacity-90'
      : 'bg-clinic-primary hover:bg-clinic-primary-hover';

  return (
    <section className="overflow-hidden rounded-xl border border-status-blue-text/20 bg-clinic-surface shadow-clinic">
      <header className="flex flex-col gap-3 border-b border-clinic-border bg-status-blue-bg px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-white p-2 text-status-blue-text shadow-sm">
            <UserRoundCheck size={21} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-status-blue-text">
              Administração
            </p>
            <h2 className="text-lg font-bold text-clinic-text">Solicitações de acesso</h2>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadRequests()}
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-lg border border-status-blue-text/20 bg-white px-3 py-2 text-xs font-bold text-status-blue-text transition hover:bg-status-blue-bg disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </header>

      {!previewRequests && (
        <div className="px-5 pt-5">
          {resetCredentials && (
            <div className="mb-5 rounded-xl border border-status-green-text/25 bg-status-green-bg p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-status-green-text">Nova senha temporária</p>
                  <p className="mt-1 text-sm text-clinic-text-muted">Copie os dados agora. A senha será removida desta tela ao fechar.</p>
                </div>
                <button type="button" onClick={() => setResetCredentials(null)} className="rounded-lg p-2 text-clinic-text-muted hover:bg-white" aria-label="Fechar nova senha"><X size={17} /></button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {[
                  ['Link', `${window.location.origin}${resetCredentials.accessPath}`],
                  ['Usuário', resetCredentials.username],
                  ['Senha temporária', resetCredentials.temporaryPassword],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center gap-2 rounded-lg bg-white p-3">
                    <div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase text-clinic-text-muted">{label}</p><p className="mt-1 break-all text-sm font-bold text-clinic-text">{value}</p></div>
                    <button type="button" onClick={() => void navigator.clipboard.writeText(value)} className="rounded-lg border border-clinic-border p-2 text-clinic-primary" aria-label={`Copiar ${label}`}><Clipboard size={15} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DirectAccessAdminCard
            patients={patients}
            onCreated={created => {
              setRequests(current => [created, ...current.filter(item => item.id !== created.id)]);
              setActiveTab('approved');
            }}
          />
        </div>
      )}

      <div className="border-b border-clinic-border px-5 pt-4">
        <div className="flex gap-2 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2 text-xs font-bold transition ${
                activeTab === tab.id
                  ? 'border-clinic-primary bg-clinic-bg text-clinic-primary'
                  : 'border-transparent text-clinic-text-muted hover:text-clinic-primary'
              }`}
            >
              {tab.label} ({counts[tab.id]})
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {loading && (
          <div className="flex items-center justify-center gap-3 py-8 text-sm font-medium text-clinic-text-muted">
            <Loader2 size={20} className="animate-spin text-clinic-primary" />
            Carregando solicitações...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-4 py-3 text-sm text-status-red-text">
            {error}
          </div>
        )}

        {!loading && !error && visibleRequests.length === 0 && (
          <div className="flex items-center justify-center gap-3 rounded-xl border border-clinic-border bg-clinic-bg px-4 py-6 text-sm text-clinic-text-muted">
            <ShieldCheck size={20} className="text-status-green-text" />
            Nenhuma solicitação nesta categoria.
          </div>
        )}

        {!loading && !error && visibleRequests.length > 0 && (
          <div className="space-y-4">
            {visibleRequests.map(request => {
              const reviewing = reviewingId === request.id;
              const status = request.status === 'approved' && isSuspended(request)
                ? { icon: ShieldOff, label: 'Suspenso', className: 'text-status-orange-text bg-status-orange-bg' }
                : request.status === 'approved' && isExpired(request)
                  ? { icon: CircleAlert, label: 'Expirado', className: 'text-status-red-text bg-status-red-bg' }
                  : statusBadge(request.status);
              const StatusIcon = status.icon;
              const notification = notificationLabel(request);
              const NotificationIcon = notification?.icon;

              return (
                <article key={request.id} className="rounded-xl border border-clinic-border bg-clinic-bg p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-bold text-clinic-text">{request.displayName}</h3>
                          <p className="break-all text-sm text-clinic-text-muted">{request.username || request.contactEmail || request.email}</p>
                        </div>
                        <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${status.className}`}>
                          <StatusIcon size={12} />
                          {status.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-clinic-text-muted">
                        {request.directAccess && <span><strong>Acesso:</strong> Direto por usuário</span>}
                        <span><strong>WhatsApp:</strong> {request.phone || 'Não informado'}</span>
                        <span><strong>Perfil:</strong> {roleLabel(request.role)}</span>
                        <span><strong>Solicitado:</strong> {formatDateTime(request.submittedAt)}</span>
                        <span><strong>UID:</strong> {request.uid || 'Ainda não vinculado'}</span>
                        {request.status === 'approved' && <span><strong>Validade:</strong> {validityLabel(request)}</span>}
                        {request.status === 'approved' && isSuspended(request) && <span><strong>Situação:</strong> Suspenso</span>}
                      </div>

                      {request.status === 'approved' && !request.uid && (
                        <p className="flex items-start gap-2 rounded-lg border border-status-orange-text/25 bg-status-orange-bg px-3 py-2 text-xs font-bold text-status-orange-text">
                          <CircleAlert size={16} className="mt-0.5 shrink-0" />
                          Esta aprovação ainda não possui conta Firebase vinculada. Peça ao usuário para criar novo cadastro com e-mail e senha ou entrar com Google usando o mesmo e-mail.
                        </p>
                      )}

                      {request.status !== 'pending' && !['revoked', 'disabled', 'canceled'].includes(request.status) && (
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-clinic-text-muted">
                          <span>
                            <strong>Analisado:</strong> {formatDateTime(request.reviewedAt)}
                          </span>
                          <span>
                            <strong>Administrador:</strong>{' '}
                            {request.approvedByEmail || request.rejectedByEmail || request.reviewedBy || 'Não informado'}
                          </span>
                        </div>
                      )}

                      {['revoked', 'disabled', 'canceled'].includes(request.status) && (
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-clinic-text-muted">
                          <span><strong>Revogado:</strong> {formatDateTime(request.revokedAt || request.reviewedAt)}</span>
                          <span>
                            <strong>Administrador:</strong>{' '}
                            {request.revokedByEmail || request.revokedBy || request.reviewedBy || 'Não informado'}
                          </span>
                        </div>
                      )}

                      {notification && NotificationIcon && (
                        <div className={`flex w-fit items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${notification.className}`}>
                          <NotificationIcon size={15} />
                          {notification.label}
                        </div>
                      )}

                      {request.emailNotificationError && (
                        <p className="rounded-lg border border-status-red-text/20 bg-status-red-bg px-3 py-2 text-xs text-status-red-text">
                          {request.emailNotificationError}
                        </p>
                      )}

                      {request.informationRequestMessage && (
                        <div className="rounded-xl border border-status-orange-text/25 bg-status-orange-bg p-3 text-sm">
                          <p className="text-[10px] font-black uppercase tracking-wide text-status-orange-text">
                            Informações solicitadas em {formatDateTime(request.informationRequestedAt)}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-clinic-text">{request.informationRequestMessage}</p>
                          {request.informationResponseMessage ? (
                            <div className="mt-3 rounded-lg bg-white/70 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wide text-status-blue-text">
                                Resposta recebida em {formatDateTime(request.informationRespondedAt)}
                              </p>
                              <p className="mt-2 whitespace-pre-wrap text-clinic-text-muted">{request.informationResponseMessage}</p>
                            </div>
                          ) : (
                            <p className="mt-2 text-xs font-bold text-status-orange-text">Aguardando resposta do solicitante.</p>
                          )}
                        </div>
                      )}

                      {request.status === 'approved' && request.suspensionReason && isSuspended(request) && (
                        <p className="rounded-lg border border-status-orange-text/25 bg-status-orange-bg px-3 py-2 text-xs text-status-orange-text">
                          <strong>Motivo da suspensão:</strong> {request.suspensionReason}
                        </p>
                      )}

                      {request.linkedPatientName && (
                        <p className="text-sm text-clinic-text-muted">
                          <strong>Paciente informado no cadastro:</strong> {request.linkedPatientName}
                        </p>
                      )}

                      {request.role === 'responsible'
                        && ['pending', 'approved'].includes(request.status) && (
                        <div className="rounded-xl border border-status-blue-text/20 bg-status-blue-bg p-3">
                          <div className="mb-2 flex items-center gap-2 text-xs font-bold text-status-blue-text">
                            <Link2 size={15} />
                            Vínculo manual com atendente ({request.linkedPatientIds.length}/3)
                          </div>
                          {request.linkedPatientIds.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-2">
                              {request.linkedPatientIds.map(patientId => {
                                const linked = selectablePatients.find(patient => patient.id === patientId);
                                return (
                                  <span key={patientId} className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-status-blue-text">
                                    {linked?.name || patientId}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <select
                              value={patientSelections[request.id] ?? ''}
                              onChange={event => setPatientSelections(current => ({
                                ...current,
                                [request.id]: event.target.value,
                              }))}
                              disabled={linkingId === request.id || !!reviewingId}
                              className="clinic-input min-w-0 flex-1 bg-white"
                              aria-label={`Paciente vinculado a ${request.displayName}`}
                            >
                              <option value="">Selecione manualmente</option>
                              {selectablePatients.map(patient => (
                                <option key={patient.id} value={patient.id} disabled={request.linkedPatientIds.includes(patient.id)}>
                                  {patient.name} ({patient.status}){request.linkedPatientIds.includes(patient.id) ? ' — já vinculado' : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => void linkPatient(request)}
                              disabled={
                                linkingId === request.id
                                || !!reviewingId
                                || !selectablePatients.length
                                || request.linkedPatientIds.length >= 3
                                || !patientSelections[request.id]
                              }
                              className="flex items-center justify-center gap-2 rounded-lg bg-status-blue-text px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                            >
                              {linkingId === request.id
                                ? <Loader2 size={15} className="animate-spin" />
                                : <Link2 size={15} />}
                              Salvar vínculo
                            </button>
                          </div>
                          {!selectablePatients.length && (
                            <p className="mt-2 text-xs text-status-orange-text">
                              Nenhum paciente está disponível para seleção.
                            </p>
                          )}
                        </div>
                      )}
                      {request.notes && (
                        <p className="whitespace-pre-wrap rounded-lg border border-clinic-border bg-clinic-surface px-3 py-2 text-sm text-clinic-text-muted">
                          {request.notes}
                        </p>
                      )}
                    </div>

                    {request.status === 'pending' && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (request.role === 'monitoring') {
                              openActionModal('approveMonitoring', request);
                            } else {
                              void review(request, 'approve');
                            }
                          }}
                          disabled={reviewing || !!reviewingId}
                          className="flex items-center gap-2 rounded-lg bg-status-green-text px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                        >
                          {reviewing ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                          Aprovar
                        </button>
                        <button
                          type="button"
                          onClick={() => void review(request, 'reject')}
                          disabled={reviewing || !!reviewingId}
                          className="flex items-center gap-2 rounded-lg bg-status-red-text px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                        >
                          <X size={15} />
                          Rejeitar
                        </button>
                        <button
                          type="button"
                          onClick={() => openActionModal('requestInformation', request)}
                          disabled={reviewing || !!reviewingId}
                          className="flex items-center gap-2 rounded-lg border border-status-orange-text/30 bg-white px-4 py-2 text-xs font-bold text-status-orange-text transition hover:bg-status-orange-bg disabled:opacity-50"
                        >
                          <CircleAlert size={15} />
                          Solicitar mais informações
                        </button>
                      </div>
                    )}

                    {request.status === 'approved' && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {request.directAccess && (
                          <button
                            type="button"
                            onClick={() => setResetPasswordRequest(request)}
                            disabled={resettingId === request.id || !!reviewingId}
                            className="flex items-center justify-center gap-2 rounded-lg border border-clinic-primary/30 bg-white px-4 py-2 text-xs font-bold text-clinic-primary transition hover:bg-clinic-bg disabled:opacity-50"
                          >
                            {resettingId === request.id ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                            Gerar nova senha
                          </button>
                        )}
                        {isSuspended(request) ? (
                          <button
                            type="button"
                            onClick={() => openActionModal('reactivate', request)}
                            disabled={reviewing || !!reviewingId}
                            className="flex items-center justify-center gap-2 rounded-lg bg-status-green-text px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                          >
                            {reviewing ? <Loader2 size={15} className="animate-spin" /> : <CircleCheck size={15} />}
                            Reativar acesso
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openActionModal('suspend', request)}
                            disabled={reviewing || !!reviewingId}
                            className="flex items-center justify-center gap-2 rounded-lg border border-status-orange-text/30 bg-white px-4 py-2 text-xs font-bold text-status-orange-text transition hover:bg-status-orange-bg disabled:opacity-50"
                          >
                            {reviewing ? <Loader2 size={15} className="animate-spin" /> : <ShieldOff size={15} />}
                            Suspender acesso
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openActionModal('validity', request)}
                          disabled={reviewing || !!reviewingId}
                          className="flex items-center justify-center gap-2 rounded-lg border border-status-blue-text/30 bg-white px-4 py-2 text-xs font-bold text-status-blue-text transition hover:bg-status-blue-bg disabled:opacity-50"
                        >
                          <Clock3 size={15} />
                          {isExpired(request) ? 'Renovar acesso' : request.expiresAt ? 'Alterar validade' : 'Definir validade'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openActionModal('revoke', request)}
                          disabled={reviewing || !!reviewingId}
                          className="flex items-center justify-center gap-2 rounded-lg border border-status-red-text/30 bg-white px-4 py-2 text-xs font-bold text-status-red-text transition hover:bg-status-red-bg disabled:opacity-50"
                        >
                          {reviewing ? <Loader2 size={15} className="animate-spin" /> : <ShieldOff size={15} />}
                          Revogar acesso
                        </button>
                      </div>
                    )}

                    {canDeleteAccessRegistration(request) && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openActionModal('deleteAccess', request)}
                          disabled={reviewing || !!reviewingId}
                          className="flex items-center justify-center gap-2 rounded-lg border border-status-red-text/30 bg-status-red-bg px-4 py-2 text-xs font-black text-status-red-text transition hover:bg-red-100 disabled:opacity-50"
                        >
                          <X size={15} />
                          Excluir cadastro de acesso
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        isOpen={!!resetPasswordRequest}
        onClose={() => { if (!resettingId) setResetPasswordRequest(null); }}
        title="Gerar nova senha temporária"
        width="max-w-lg"
        closeDisabled={!!resettingId}
      >
        {resetPasswordRequest && (
          <div className="space-y-5">
            <div className="rounded-xl border border-status-orange-text/25 bg-status-orange-bg p-4 text-sm text-status-orange-text">
              <p className="font-black">A senha atual deixará de funcionar.</p>
              <p className="mt-2">O usuário receberá uma nova senha temporária e deverá criar uma senha particular no próximo acesso.</p>
              <p className="mt-2">Suspensão, revogação e validade não serão alteradas por esta ação.</p>
            </div>
            <div className="rounded-xl border border-clinic-border bg-clinic-bg p-4">
              <p className="font-bold text-clinic-text">{resetPasswordRequest.displayName}</p>
              <p className="mt-1 text-sm text-clinic-text-muted">{resetPasswordRequest.username || resetPasswordRequest.contactEmail || resetPasswordRequest.email}</p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setResetPasswordRequest(null)} disabled={!!resettingId} className="rounded-xl border border-clinic-border bg-white px-4 py-3 text-sm font-bold text-clinic-text disabled:opacity-60">Cancelar</button>
              <button type="button" onClick={() => void submitPasswordReset()} disabled={!!resettingId} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
                {resettingId ? <Loader2 size={17} className="animate-spin" /> : <KeyRound size={17} />}
                Gerar nova senha
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!actionModal}
        onClose={closeActionModal}
        title={modalTitle}
        width="max-w-lg"
        closeDisabled={modalBusy}
        initialFocusRef={modalPrimaryRef}
      >
        {actionModal && actionRequest && (
          <form
            className="space-y-5"
            onSubmit={event => {
              event.preventDefault();
              void submitActionModal();
            }}
          >
            <div className="rounded-xl border border-clinic-border bg-clinic-bg p-4">
              <p className="text-sm font-bold text-clinic-text">{actionRequest.displayName}</p>
              <p className="mt-1 break-all text-xs text-clinic-text-muted">{actionRequest.username || actionRequest.contactEmail || actionRequest.email}</p>
              <p className="mt-2 text-xs text-clinic-text-muted">
                Perfil: <strong>{roleLabel(actionRequest.role)}</strong>
                {actionRequest.status === 'approved' && <> · Validade: <strong>{validityLabel(actionRequest)}</strong></>}
              </p>
            </div>

            {actionModal.kind === 'suspend' && (
              <>
                <p className="text-sm leading-relaxed text-clinic-text-muted">
                  O usuário perderá temporariamente o acesso ao Monitoramento. A suspensão poderá ser revertida posteriormente.
                </p>
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">
                    Motivo da suspensão — opcional
                  </span>
                  <textarea
                    ref={element => { modalPrimaryRef.current = element; }}
                    value={modalText}
                    onChange={event => setModalText(event.target.value)}
                    maxLength={SUSPENSION_REASON_MAX_LENGTH}
                    disabled={modalBusy}
                    className="clinic-input min-h-28 resize-y bg-white"
                  />
                  <span className="mt-1 block text-right text-[11px] font-bold text-clinic-text-muted">
                    {modalText.length}/{SUSPENSION_REASON_MAX_LENGTH}
                  </span>
                </label>
              </>
            )}

            {actionModal.kind === 'reactivate' && (
              <p className="text-sm leading-relaxed text-clinic-text-muted">
                O usuário voltará a acessar o Monitoramento, desde que o acesso não esteja expirado ou revogado. Validade e revogação continuam sendo verificadas pelo backend.
              </p>
            )}

            {actionModal.kind === 'revoke' && (
              <p className="text-sm leading-relaxed text-clinic-text-muted">
                {REVOCATION_CONFIRMATION}
              </p>
            )}

            {actionModal.kind === 'deleteAccess' && (
              <>
                <div className="space-y-2 rounded-xl border border-status-red-text/20 bg-status-red-bg p-4 text-sm text-status-red-text">
                  <p className="font-black">Esta ação excluirá somente o cadastro de acesso do perfil {roleLabel(actionRequest.role)}.</p>
                  <p>A conta de autenticação Firebase, os demais perfis, pacientes, agenda, pagamentos, mídias, registros clínicos e atividades permanecerão.</p>
                  <p>Revogar mantém histórico; excluir remove este cadastro de acesso e permite nova solicitação futura deste perfil.</p>
                </div>
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">
                    Digite EXCLUIR {actionRequest.role === 'monitoring' ? 'MONITORAMENTO' : actionRequest.role === 'responsible' ? 'RESPONSAVEL' : 'PROFISSIONAL'}
                  </span>
                  <input
                    ref={element => { modalPrimaryRef.current = element; }}
                    value={modalText}
                    onChange={event => setModalText(event.target.value)}
                    disabled={modalBusy}
                    required
                    className="clinic-input bg-white"
                  />
                </label>
              </>
            )}

            {actionModal.kind === 'requestInformation' && (
              <>
                <p className="text-sm leading-relaxed text-clinic-text-muted">
                  Escreva de forma objetiva qual informação o solicitante deverá enviar antes de uma nova análise.
                </p>
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">
                    Informação solicitada
                  </span>
                  <textarea
                    ref={element => { modalPrimaryRef.current = element; }}
                    value={modalText}
                    onChange={event => setModalText(event.target.value)}
                    maxLength={INFORMATION_MESSAGE_MAX_LENGTH}
                    disabled={modalBusy}
                    required
                    className="clinic-input min-h-32 resize-y bg-white"
                  />
                  <span className="mt-1 block text-right text-[11px] font-bold text-clinic-text-muted">
                    {modalText.length}/{INFORMATION_MESSAGE_MAX_LENGTH}
                  </span>
                </label>
              </>
            )}

            {showValidityFields && (
              <div className="space-y-4">
                {actionModal.kind === 'validity' && actionRequest.expiresAt && (
                  <p className={`rounded-lg px-3 py-2 text-xs font-bold ${isExpired(actionRequest) ? 'bg-status-red-bg text-status-red-text' : 'bg-status-blue-bg text-status-blue-text'}`}>
                    {validityLabel(actionRequest)}
                  </p>
                )}
                <fieldset className="space-y-3">
                  <legend className="mb-2 text-xs font-black uppercase tracking-wider text-clinic-text-muted">Validade do acesso</legend>
                  <label className="flex items-center gap-3 rounded-xl border border-clinic-border bg-white px-3 py-3 text-sm font-bold text-clinic-text">
                    <input
                      ref={element => { modalPrimaryRef.current = element; }}
                      type="radio"
                      name="access-validity"
                      checked={validityMode === 'none'}
                      onChange={() => setValidityMode('none')}
                      disabled={modalBusy}
                      className="h-4 w-4 accent-clinic-primary"
                    />
                    Sem prazo
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-clinic-border bg-white px-3 py-3 text-sm font-bold text-clinic-text">
                    <input
                      type="radio"
                      name="access-validity"
                      checked={validityMode === 'date'}
                      onChange={() => setValidityMode('date')}
                      disabled={modalBusy}
                      className="h-4 w-4 accent-clinic-primary"
                    />
                    Válido até uma data
                  </label>
                </fieldset>
                {validityMode === 'date' && (
                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-wider text-clinic-text-muted">
                      Data final (AAAA-MM-DD)
                    </span>
                    <input
                      ref={element => { modalPrimaryRef.current = element; }}
                      type="date"
                      value={validityDate}
                      onChange={event => setValidityDate(event.target.value)}
                      disabled={modalBusy}
                      required
                      className="clinic-input bg-white"
                    />
                    <span className="mt-1 block text-xs text-clinic-text-muted">
                      A data escolhida será tratada como válida até o final desse dia em America/Sao_Paulo.
                    </span>
                  </label>
                )}
              </div>
            )}

            {showTextArea && modalText.length >= textAreaMaxLength - 80 && (
              <p className="text-xs font-bold text-status-orange-text">
                O texto está próximo do limite máximo permitido.
              </p>
            )}

            {modalError && (
              <div className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-4 py-3 text-sm font-bold text-status-red-text" role="alert">
                {modalError}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeActionModal}
                disabled={modalBusy}
                className="rounded-xl border border-clinic-border bg-white px-4 py-3 text-sm font-bold text-clinic-text transition hover:bg-clinic-bg disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                ref={element => {
                  if (!showTextArea && !showValidityFields) modalPrimaryRef.current = element;
                }}
                type="submit"
                disabled={modalBusy}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition disabled:opacity-60 ${modalSubmitClass}`}
              >
                {modalBusy && <Loader2 size={16} className="animate-spin" />}
                {modalSubmitLabel}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
