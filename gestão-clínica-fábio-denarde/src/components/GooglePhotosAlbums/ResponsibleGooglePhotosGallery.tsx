import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Images, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
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

  return (
    <section className="space-y-4 rounded-2xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-status-green-bg p-2.5 text-status-green-text"><Images size={19} /></span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-clinic-text">Galeria de atividades</h2>
            <p className="text-xs text-clinic-text-muted">Atividades autorizadas de {patientName}, abertas em uma nova guia.</p>
          </div>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-status-green-text/20 bg-status-green-bg px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-status-green-text transition-colors hover:bg-green-100 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </header>

      <div className="rounded-xl border border-status-green-text/20 bg-status-green-bg/70 p-3 text-xs text-status-green-text sm:text-sm">
        <div className="flex items-start gap-3">
          <ExternalLink size={17} className="mt-0.5 shrink-0" />
          <p><strong>Ao abrir uma atividade, uma nova guia será exibida.</strong> A página atual permanece sem carregar imagens ou vídeos.</p>
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

      {!loading && albums.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {albums.map(album => (
            <article key={album.id} className="flex min-w-0 flex-col rounded-2xl border border-clinic-border bg-white p-3 shadow-sm sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-status-green-bg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-status-green-text">{album.category}</span>
              </div>
              <h3 className="mt-3 break-words text-base font-bold text-clinic-text">{getGooglePhotosAlbumDisplayTitle(album)}</h3>
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
      )}

      <div className="flex items-start gap-3 rounded-xl border border-status-green-text/20 bg-status-green-bg/50 p-3 text-xs text-clinic-text-muted">
        <ShieldCheck size={18} className="shrink-0 text-status-green-text" />
        <p>Somente atividades ativas e autorizadas pela clínica são exibidas nesta aba.</p>
      </div>
    </section>
  );
}
