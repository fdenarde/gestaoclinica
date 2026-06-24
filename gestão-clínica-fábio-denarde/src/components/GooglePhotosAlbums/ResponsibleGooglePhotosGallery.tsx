import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Images, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { GooglePhotosAlbum } from '../../types/googlePhotosAlbums';
import {
  GOOGLE_PHOTOS_ALBUMS_CHANGED_EVENT,
  listGooglePhotosAlbums,
} from '../../lib/googlePhotosAlbumsApi';
import { safeFormatDate } from '../../lib/utils';
import { getGooglePhotosAlbumDisplayTitle } from '../../../shared/googlePhotosAlbums.js';

interface Props {
  patientId: string;
  patientName: string;
  packageNumber: number;
}

interface AlbumSessionGroup {
  key: string;
  activityDate: string;
  sessionTime: string | null;
  sessionNumbers: number[];
  albums: GooglePhotosAlbum[];
  sortKey: string;
}

function albumDateTimeKey(album: GooglePhotosAlbum): string {
  return `${album.activityDate || ''}T${album.sessionTime || '00:00'}|${album.id}`;
}

function albumSessionLabel(group: AlbumSessionGroup): string {
  if (group.sessionNumbers.length === 1) return `Sessão ${group.sessionNumbers[0]}`;
  if (group.sessionNumbers.length > 1) return `Sessões ${group.sessionNumbers.join(', ')}`;
  return 'Atividade da sessão';
}

export default function ResponsibleGooglePhotosGallery({ patientId, patientName, packageNumber }: Props) {
  const [albums, setAlbums] = useState<GooglePhotosAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadingRef = useRef(false);

  const load = useCallback(async (force = false) => {
    if (loadingRef.current) return;
    if (!patientId || !packageNumber) {
      setAlbums([]);
      setLoading(false);
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await listGooglePhotosAlbums({ patientId, packageNumber, scope: 'portal', force });
      setAlbums(result.albums);
    } catch (caughtError) {
      console.error('Falha ao carregar atividades autorizadas no portal:', caughtError);
      setError('Não foi possível carregar as atividades autorizadas. Tente novamente.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [packageNumber, patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handlePackageChange = (event: WindowEventMap[typeof GOOGLE_PHOTOS_ALBUMS_CHANGED_EVENT]) => {
      const detail = event.detail;
      if (
        detail?.patientId === patientId
        && Number(detail.packageNumber) === Number(packageNumber)
      ) {
        void load(true);
      }
    };
    window.addEventListener(GOOGLE_PHOTOS_ALBUMS_CHANGED_EVENT, handlePackageChange);
    return () => window.removeEventListener(GOOGLE_PHOTOS_ALBUMS_CHANGED_EVENT, handlePackageChange);
  }, [load, packageNumber, patientId]);

  const sessionGroups = useMemo<AlbumSessionGroup[]>(() => {
    const grouped = new Map<string, GooglePhotosAlbum[]>();

    for (const album of albums) {
      const groupKey = album.sessionGroupKey
        || `${album.activityDate}|${album.sessionTime || ''}|${album.sessionId || album.id}`;
      const current = grouped.get(groupKey) || [];
      current.push(album);
      grouped.set(groupKey, current);
    }

    return [...grouped.entries()]
      .map(([key, groupAlbums]) => {
        const orderedAlbums = groupAlbums
          .slice()
          .sort((left, right) => albumDateTimeKey(right).localeCompare(albumDateTimeKey(left)));
        const referenceAlbum = orderedAlbums[0];
        const sessionNumbers = [...new Set(
          orderedAlbums.flatMap(album => album.sessionNumbers || []),
        )].sort((left, right) => right - left);

        return {
          key,
          activityDate: referenceAlbum.activityDate,
          sessionTime: referenceAlbum.sessionTime,
          sessionNumbers,
          albums: orderedAlbums,
          sortKey: albumDateTimeKey(referenceAlbum),
        };
      })
      .sort((left, right) => (
        right.sortKey.localeCompare(left.sortKey)
        || right.key.localeCompare(left.key)
      ));
  }, [albums]);

  return (
    <section className="space-y-4 rounded-2xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-status-green-bg p-2.5 text-status-green-text"><Images size={19} /></span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-clinic-text">Galeria de atividades</h2>
            <p className="text-xs text-clinic-text-muted">Sessões de {patientName} em ordem da mais recente para a mais antiga.</p>
          </div>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-status-green-text/20 bg-status-green-bg px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-status-green-text transition-colors hover:bg-green-100 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </header>

      <div className="rounded-xl border border-status-green-text/20 bg-status-green-bg/70 p-3 text-xs text-status-green-text sm:text-sm">
        <div className="flex items-start gap-3">
          <ExternalLink size={17} className="mt-0.5 shrink-0" />
          <p><strong>Abra primeiro a sessão desejada.</strong> Ao selecionar uma atividade, o álbum será exibido em uma nova guia sem carregar fotos ou vídeos nesta página.</p>
        </div>
      </div>

      {error && <div className="rounded-xl border border-status-red-text/20 bg-status-red-bg p-3 text-sm font-bold text-status-red-text">{error}</div>}
      {loading && <div className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-clinic-border bg-clinic-bg text-sm font-bold text-clinic-text-muted"><Loader2 size={20} className="animate-spin" /> Carregando atividades autorizadas...</div>}

      {!loading && !error && albums.length === 0 && (
        <div className="rounded-xl border border-dashed border-clinic-border bg-clinic-bg p-6 text-center">
          <Images size={30} className="mx-auto text-clinic-text-faint" />
          <p className="mt-3 font-bold text-clinic-text">Nenhuma atividade disponível nesta área</p>
          <p className="mt-1 text-sm text-clinic-text-muted">Quando uma atividade for disponibilizada, ela aparecerá aqui.</p>
        </div>
      )}

      {!loading && sessionGroups.length > 0 && (
        <div className="space-y-3">
          {sessionGroups.map(group => (
            <details key={group.key} className="group overflow-hidden rounded-2xl border border-clinic-border bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-green-text/30 [&::-webkit-details-marker]:hidden">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-status-green-bg text-status-green-text">
                  <Images size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black text-clinic-text">{albumSessionLabel(group)}</h3>
                    <span className="rounded-full bg-status-green-bg px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-status-green-text">
                      {group.albums.length} {group.albums.length === 1 ? 'atividade' : 'atividades'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-clinic-text-muted">
                    {safeFormatDate(group.activityDate, 'dd/MM/yyyy')}{group.sessionTime ? ` às ${group.sessionTime}` : ''}
                  </p>
                </div>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-clinic-border bg-clinic-bg text-status-green-text">
                  <ChevronDown size={18} className="transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
                </span>
              </summary>

              <div className="border-t border-clinic-border p-3 sm:p-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.albums.map(album => (
                    <article key={album.id} className="flex min-w-0 flex-col rounded-2xl border border-clinic-border bg-white p-3 shadow-sm sm:p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-status-green-bg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-status-green-text">{album.category}</span>
                      </div>
                      <h4 className="mt-3 break-words text-base font-bold text-clinic-text">{getGooglePhotosAlbumDisplayTitle(album)}</h4>
                      <div className="mt-3 flex-1 space-y-2 text-sm">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Data</p>
                          <p className="font-semibold text-clinic-text">{safeFormatDate(album.activityDate, 'dd/MM/yyyy')}{album.sessionTime ? ` às ${album.sessionTime}` : ''}</p>
                        </div>
                        {album.observation && (
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Observação</p>
                            <p className="line-clamp-3 whitespace-pre-wrap text-clinic-text-muted">{album.observation}</p>
                          </div>
                        )}
                      </div>
                      <a href={album.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-status-green-text px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-status-green-text/30 focus:ring-offset-2">
                        Abrir Atividade <ExternalLink size={15} />
                      </a>
                    </article>
                  ))}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-status-green-text/20 bg-status-green-bg/50 p-3 text-xs text-clinic-text-muted">
        <ShieldCheck size={18} className="shrink-0 text-status-green-text" />
        <p>Somente atividades ativas e autorizadas pela clínica são exibidas nesta aba.</p>
      </div>
    </section>
  );
}
