import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Patient } from '../../types';
import { getPatientPhotoSignedUrl } from '../../lib/patientPhotoStorage';

interface PatientPhotoProps {
  patient: Pick<Patient, 'name' | 'photoUrl' | 'photoDriveFileId'>;
  className: string;
  alt?: string;
  onClick?: () => void;
  expandable?: boolean;
  fallbackClassName?: string;
  fallbackText?: string;
}

export default function PatientPhoto({
  patient,
  className,
  alt,
  onClick,
  expandable = false,
  fallbackClassName,
  fallbackText,
}: PatientPhotoProps) {
  const [resolvedUrl, setResolvedUrl] = useState(patient.photoDriveFileId ? '' : patient.photoUrl || '');
  const [failed, setFailed] = useState(false);
  const [retryAttempted, setRetryAttempted] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setRetryAttempted(false);
    setIsExpanded(false);

    if (!patient.photoDriveFileId) {
      setResolvedUrl(patient.photoUrl || '');
      return () => {
        active = false;
      };
    }

    setResolvedUrl('');
    getPatientPhotoSignedUrl(patient.photoDriveFileId)
      .then(url => {
        if (active) setResolvedUrl(url);
      })
      .catch(error => {
        console.error('Não foi possível carregar a foto do atendente:', error);
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [patient.photoDriveFileId, patient.photoUrl]);

  useEffect(() => {
    if (!isExpanded || typeof document === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsExpanded(false);
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isExpanded]);

  const retryOnce = async () => {
    if (!patient.photoDriveFileId || retryAttempted) {
      setFailed(true);
      return;
    }

    setRetryAttempted(true);
    try {
      const refreshedUrl = await getPatientPhotoSignedUrl(patient.photoDriveFileId, true);
      setResolvedUrl(refreshedUrl);
    } catch (error) {
      console.error('Não foi possível renovar o endereço temporário da foto:', error);
      setFailed(true);
    }
  };

  const isInteractive = Boolean(onClick || expandable);

  const activatePhoto = () => {
    if (onClick) {
      onClick();
      return;
    }

    if (expandable) setIsExpanded(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLImageElement>) => {
    if (!isInteractive || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    activatePhoto();
  };

  if (!resolvedUrl || failed) {
    return (
      <div className={fallbackClassName || className} aria-label={`Sem foto de ${patient.name}`}>
        {fallbackText || patient.name.split(' ').map(part => part[0]).slice(0, 2).join('')}
      </div>
    );
  }

  const lightbox = expandable && isExpanded && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Foto ampliada de ${patient.name}`}
          onClick={() => setIsExpanded(false)}
        >
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-3xl leading-none text-white shadow-lg transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-white"
            aria-label="Fechar foto ampliada"
            title="Fechar"
          >
            ×
          </button>

          <div className="flex max-h-[94vh] max-w-[96vw] flex-col items-center gap-3" onClick={event => event.stopPropagation()}>
            <img
              src={resolvedUrl}
              alt={`Foto ampliada de ${patient.name}`}
              onError={retryOnce}
              className="max-h-[86vh] max-w-[94vw] rounded-2xl object-contain shadow-2xl animate-in zoom-in-95"
            />
            <p className="max-w-[90vw] truncate rounded-full bg-black/55 px-4 py-2 text-sm font-semibold text-white">
              {patient.name}
            </p>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <img
        src={resolvedUrl}
        alt={alt || patient.name}
        onClick={isInteractive ? activatePhoto : undefined}
        onKeyDown={handleKeyDown}
        onError={retryOnce}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-haspopup={expandable ? 'dialog' : undefined}
        title={expandable && !onClick ? 'Clique para ampliar' : undefined}
        className={`${className}${isInteractive ? ' cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-clinic-primary focus:ring-offset-2' : ''}`}
      />
      {lightbox}
    </>
  );
}
