import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
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
  linkResponsiblePatient,
  listAccessRequests,
  reviewAccessRequest,
  revokeAccessRequest,
} from '../../lib/accessApi';
import type { Patient } from '../../types';
import type { AccessRequestRecord, AccessRequestStatus } from '../../types/access';
import { showToast } from '../Common/Toast';

type RequestTab = 'pending' | 'approved' | 'rejected' | 'revoked';

const TABS: Array<{ id: RequestTab; label: string }> = [
  { id: 'pending', label: 'Pendentes' },
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

function roleLabel(role: AccessRequestRecord['role']): string {
  return role === 'responsible' ? 'Responsável' : 'Profissional';
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

interface AccessRequestsAdminCardProps {
  patients: Patient[];
}

export default function AccessRequestsAdminCard({ patients }: AccessRequestsAdminCardProps) {
  const [requests, setRequests] = useState<AccessRequestRecord[]>([]);
  const [activeTab, setActiveTab] = useState<RequestTab>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewingId, setReviewingId] = useState('');
  const [linkingId, setLinkingId] = useState('');
  const [patientSelections, setPatientSelections] = useState<Record<string, string>>({});

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRequests(await listAccessRequests());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar as solicitações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

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
      { pending: 0, approved: 0, rejected: 0, revoked: 0 },
    ),
    [requests],
  );

  const review = async (request: AccessRequestRecord, decision: 'approve' | 'reject') => {
    setReviewingId(request.id);
    try {
      const reviewedRequest = await reviewAccessRequest(request.id, decision);
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

  const revoke = async (request: AccessRequestRecord) => {
    if (!window.confirm(REVOCATION_CONFIRMATION)) return;

    setReviewingId(request.id);
    try {
      const revokedRequest = await revokeAccessRequest(request.id);
      setRequests(current => current.map(item => item.id === request.id ? revokedRequest : item));
      showToast('Acesso revogado. O histórico foi mantido.');
    } catch (caughtError) {
      showToast(
        caughtError instanceof Error ? caughtError.message : 'Não foi possível revogar o acesso.',
        'error',
      );
    } finally {
      setReviewingId('');
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
      const linkedRequest = await linkResponsiblePatient(request.id, patientId);
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
              const status = statusBadge(request.status);
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
                          <p className="break-all text-sm text-clinic-text-muted">{request.email}</p>
                        </div>
                        <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${status.className}`}>
                          <StatusIcon size={12} />
                          {status.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-clinic-text-muted">
                        <span><strong>WhatsApp:</strong> {request.phone}</span>
                        <span><strong>Perfil:</strong> {roleLabel(request.role)}</span>
                        <span><strong>Solicitado:</strong> {formatDateTime(request.submittedAt)}</span>
                        <span><strong>UID:</strong> {request.uid || 'Ainda não vinculado'}</span>
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
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => void review(request, 'approve')}
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
                      </div>
                    )}

                    {request.status === 'approved' && (
                      <button
                        type="button"
                        onClick={() => void revoke(request)}
                        disabled={reviewing || !!reviewingId}
                        className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-status-red-text/30 bg-white px-4 py-2 text-xs font-bold text-status-red-text transition hover:bg-status-red-bg disabled:opacity-50"
                      >
                        {reviewing ? <Loader2 size={15} className="animate-spin" /> : <ShieldOff size={15} />}
                        Revogar acesso
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
