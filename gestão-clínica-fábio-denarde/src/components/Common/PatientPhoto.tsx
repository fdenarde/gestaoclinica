import React, { useEffect, useState } from 'react';
import type { Patient } from '../../types';
import { getPatientPhotoSignedUrl } from '../../lib/patientPhotoStorage';

interface PatientPhotoProps {
  patient: Pick<Patient, 'name' | 'photoUrl' | 'photoDriveFileId'>;
  className: string;
  alt?: string;
  onClick?: () => void;
  fallbackClassName?: string;
  fallbackText?: string;
}

export default function PatientPhoto({
  patient,
  className,
  alt,
  onClick,
  fallbackClassName,
  fallbackText,
}: PatientPhotoProps) {
  const [resolvedUrl, setResolvedUrl] = useState(patient.photoDriveFileId ? '' : patient.photoUrl || '');
  const [failed, setFailed] = useState(false);
  const [retryAttempted, setRetryAttempted] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setRetryAttempted(false);

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

  if (!resolvedUrl || failed) {
    return (
      <div className={fallbackClassName || className} aria-label={`Sem foto de ${patient.name}`}>
        {fallbackText || patient.name.split(' ').map(part => part[0]).slice(0, 2).join('')}
      </div>
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt || patient.name}
      onClick={onClick}
      onError={retryOnce}
      className={className}
    />
  );
}
