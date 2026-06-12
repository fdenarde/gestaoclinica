import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CalendarDays,
  Clock3,
  Download,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Play,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { logout } from '../../firebase';
import { getResponsibleMediaUrl, getResponsiblePortalData } from '../../lib/accessApi';
import { applyTheme } from '../../lib/theme';
import type {
  ResponsiblePortalData,
  ResponsiblePortalMedia,
  ResponsiblePortalSession,
} from '../../types/access';
import BrandLogo from '../Common/BrandLogo';

interface ResponsiblePortalProps {
  user: User;
}

function sessionTimestamp(session: ResponsiblePortalSession): number {
  const time = /^\d{2}:\d{2}$/.test(session.time) ? session.time : '00:00';
  const timestamp = new Date(`${session.date}T${time}:00`).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value || 'Não informada';
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function statusClass(status: string): string {
  if (status === 'Realizada') return 'bg-status-green-bg text-status-green-text';
  if (['Falta', 'Falta.Prof', 'Cancelada'].includes(status)) {
    return 'bg-status-red-bg text-status-red-text';
  }
  if (status === 'Reposição') return 'bg-status-orange-bg text-status-orange-text';
  return 'bg-status-blue-bg text-status-blue-text';
}

function SessionList({
  title,
  sessions,
  emptyMessage,
}: {
  title: string;
  sessions: ResponsiblePortalSession[];
  emptyMessage: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-clinic-border bg-clinic-surface shadow-clinic">
      <header className="flex items-center gap-3 border-b border-clinic-border bg-clinic-bg px-5 py-4">
        <CalendarDays size={20} className="text-clinic-primary" />
        <h2 className="font-bold text-clinic-text">{title}</h2>
      </header>
      <div className="divide-y divide-clinic-border">
        {sessions.length === 0 && (
          <p className="px-5 py-6 text-sm text-clinic-text-muted">{emptyMessage}</p>
        )}
        {sessions.map(session => (
          <article key={session.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold capitalize text-clinic-text">{formatDate(session.date)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-clinic-text-muted">
                <span className="flex items-center gap-1.5">
                  <Clock3 size={15} />
                  {session.time || 'Horário não informado'}
                </span>
                {session.type && <span>{session.type}</span>}
                {session.professionalName && <span>Profissional: {session.professionalName}</span>}
              </div>
            </div>
            <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${statusClass(session.status)}`}>
              {session.status}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function ResponsiblePortal({ user }: ResponsiblePortalProps) {
  const [data, setData] = useState<ResponsiblePortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [mediaLoadingId, setMediaLoadingId] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<{
    record: ResponsiblePortalMedia;
    url: string;
  } | null>(null);

  useLayoutEffect(() => {
    applyTheme('calm-tech');
  }, []);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getResponsiblePortalData(user));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar o portal.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadPortal();
  }, [loadPortal]);

  const sessions = useMemo(() => {
    const now = Date.now();
    const all = data?.sessions || [];
    return {
      upcoming: all
        .filter(session => sessionTimestamp(session) >= now)
        .sort((a, b) => sessionTimestamp(a) - sessionTimestamp(b)),
      previous: all
        .filter(session => sessionTimestamp(session) < now)
        .sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a)),
    };
  }, [data?.sessions]);

  const openMedia = async (record: ResponsiblePortalMedia) => {
    setMediaLoadingId(record.id);
    setActionError('');
    try {
      const result = await getResponsibleMediaUrl(record.patientId, record.id);
      setSelectedMedia({ record, url: result.url });
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível abrir a mídia.');
    } finally {
      setMediaLoadingId('');
    }
  };

  const downloadMedia = async (record: ResponsiblePortalMedia) => {
    setMediaLoadingId(record.id);
    setActionError('');
    try {
      const result = await getResponsibleMediaUrl(record.patientId, record.id);
      const downloadUrl = new URL(result.url, window.location.origin);
      downloadUrl.searchParams.set('download', '1');
      downloadUrl.searchParams.set('fileName', result.fileName || record.fileName);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl.toString();
      anchor.download = result.fileName || record.fileName;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível baixar a mídia.');
    } finally {
      setMediaLoadingId('');
    }
  };

  return (
    <div className="min-h-screen bg-clinic-bg">
      <header className="bg-clinic-header text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
          <BrandLogo
            variant="compact"
            name="Denarde Soluções"
            subtitle="Portal do Responsável"
          />
          <button
            type="button"
            onClick={() => void logout()}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/25 px-4 py-2 text-sm font-bold transition hover:bg-white/10"
          >
            <LogOut size={17} />
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <section className="rounded-2xl bg-gradient-to-br from-clinic-header to-clinic-primary p-6 text-white shadow-xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">Acesso individual e protegido</p>
          <h1 className="mt-2 text-3xl font-bold">Portal do Responsável</h1>
          <div className="mt-5 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:gap-8">
            <span className="flex items-center gap-2">
              <UserRound size={18} />
              {data?.responsible.displayName || user.displayName || 'Responsável'}
            </span>
            <span className="break-all text-white/80">{data?.responsible.email || user.email}</span>
          </div>
        </section>

        {loading && (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-clinic-border bg-clinic-surface text-clinic-text-muted">
            <Loader2 size={30} className="animate-spin text-clinic-primary" />
            Carregando informações autorizadas...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-status-red-text/20 bg-status-red-bg p-5 text-sm text-status-red-text">
            <p className="font-bold">{error}</p>
            <button
              type="button"
              onClick={() => void loadPortal()}
              className="mt-4 flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-bold shadow-sm"
            >
              <RefreshCw size={15} />
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !error && data && !data.patient && (
          <section className="rounded-2xl border border-status-orange-text/25 bg-status-orange-bg p-6 text-center">
            <ShieldCheck className="mx-auto text-status-orange-text" size={36} />
            <p className="mx-auto mt-4 max-w-2xl font-bold text-clinic-text">
              Seu acesso foi aprovado, mas ainda não há paciente vinculado ao seu perfil. Entre em contato com a clínica.
            </p>
          </section>
        )}

        {!loading && !error && data?.patient && (
          <>
            {actionError && (
              <div className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-4 py-3 text-sm font-bold text-status-red-text">
                {actionError}
              </div>
            )}
            <section className="rounded-2xl border border-clinic-primary/20 bg-clinic-surface p-5 shadow-clinic">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-clinic-primary">Paciente vinculado</p>
              <h2 className="mt-2 text-2xl font-bold text-clinic-text">{data.patient.name}</h2>
              <p className="mt-2 text-sm text-clinic-text-muted">
                Este portal permite somente visualização das informações autorizadas pela clínica.
              </p>
            </section>

            <div className="grid gap-6 xl:grid-cols-2">
              <SessionList
                title="Próximas sessões"
                sessions={sessions.upcoming}
                emptyMessage="Não há próximas sessões cadastradas."
              />
              <SessionList
                title="Sessões anteriores"
                sessions={sessions.previous}
                emptyMessage="Não há sessões anteriores cadastradas."
              />
            </div>

            <section className="overflow-hidden rounded-2xl border border-clinic-border bg-clinic-surface shadow-clinic">
              <header className="flex items-center gap-3 border-b border-clinic-border bg-clinic-bg px-5 py-4">
                <ImageIcon size={20} className="text-clinic-primary" />
                <div>
                  <h2 className="font-bold text-clinic-text">Mídias liberadas</h2>
                  <p className="text-xs text-clinic-text-muted">Somente arquivos autorizados para compartilhamento.</p>
                </div>
              </header>
              {data.media.length === 0 ? (
                <p className="px-5 py-6 text-sm text-clinic-text-muted">
                  Nenhuma mídia foi liberada para visualização.
                </p>
              ) : (
                <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
                  {data.media.map(record => (
                    <article key={record.id} className="rounded-xl border border-clinic-border bg-clinic-bg p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="rounded-xl bg-status-blue-bg p-2 text-status-blue-text">
                          {record.mediaType === 'video' ? <Play size={20} /> : <ImageIcon size={20} />}
                        </div>
                        <span className="text-xs text-clinic-text-muted">
                          {formatDate(record.sessionDate)}
                        </span>
                      </div>
                      <h3 className="mt-3 font-bold text-clinic-text">{record.category}</h3>
                      <p className="mt-1 truncate text-xs text-clinic-text-muted">{record.fileName}</p>
                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void openMedia(record)}
                          disabled={!!mediaLoadingId}
                          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-clinic-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                          {mediaLoadingId === record.id
                            ? <Loader2 size={14} className="animate-spin" />
                            : record.mediaType === 'video' ? <Play size={14} /> : <ImageIcon size={14} />}
                          Visualizar
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadMedia(record)}
                          disabled={!!mediaLoadingId}
                          className="flex items-center justify-center rounded-lg border border-clinic-border bg-white px-3 py-2 text-clinic-primary disabled:opacity-50"
                          aria-label={`Baixar ${record.fileName}`}
                        >
                          <Download size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {selectedMedia && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl bg-clinic-surface p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-clinic-text">{selectedMedia.record.category}</p>
                <p className="text-xs text-clinic-text-muted">{selectedMedia.record.fileName}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMedia(null)}
                className="rounded-full bg-clinic-bg p-2 text-clinic-text-muted hover:text-clinic-primary"
                aria-label="Fechar mídia"
              >
                <X size={20} />
              </button>
            </div>
            {selectedMedia.record.mediaType === 'video' ? (
              <video
                src={selectedMedia.url}
                controls
                playsInline
                preload="metadata"
                className="max-h-[75vh] w-full rounded-xl bg-black"
              />
            ) : (
              <img
                src={selectedMedia.url}
                alt={selectedMedia.record.category}
                className="max-h-[75vh] w-full rounded-xl bg-black/5 object-contain"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
