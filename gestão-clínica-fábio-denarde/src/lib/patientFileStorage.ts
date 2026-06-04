import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from '../firebase';

export type PatientFileField = 'photoUrl' | 'reportPdfUrl' | 'opinionPdfUrl';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const FIELD_CONFIG: Record<PatientFileField, { folder: string; maxBytes: number; accepts: (type: string) => boolean; label: string }> = {
  photoUrl: {
    folder: 'profile',
    maxBytes: MAX_IMAGE_BYTES,
    accepts: type => type.startsWith('image/'),
    label: 'foto',
  },
  reportPdfUrl: {
    folder: 'documents/report',
    maxBytes: MAX_PDF_BYTES,
    accepts: type => type === 'application/pdf',
    label: 'relatorio',
  },
  opinionPdfUrl: {
    folder: 'documents/opinion',
    maxBytes: MAX_PDF_BYTES,
    accepts: type => type === 'application/pdf',
    label: 'parecer',
  },
};

const sanitizeFileName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'arquivo';

export const validatePatientFile = (file: File, field: PatientFileField) => {
  const config = FIELD_CONFIG[field];

  if (!config.accepts(file.type)) {
    throw new Error(field === 'photoUrl' ? 'Envie uma imagem valida.' : 'Envie um arquivo PDF valido.');
  }

  if (file.size > config.maxBytes) {
    const maxMb = Math.round(config.maxBytes / 1024 / 1024);
    throw new Error(`O arquivo de ${config.label} deve ter no maximo ${maxMb} MB.`);
  }
};

export async function uploadPatientFile(patientId: string, field: PatientFileField, file: File) {
  const userId = auth.currentUser?.uid;

  if (!userId) {
    throw new Error('Usuario nao autenticado. Faca login novamente antes de anexar arquivos.');
  }

  validatePatientFile(file, field);

  const config = FIELD_CONFIG[field];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = sanitizeFileName(file.name);
  const path = `users/${userId}/patients/${patientId}/${config.folder}/${timestamp}-${safeName}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      userId,
      patientId,
      field,
      originalName: file.name,
    },
  });

  return getDownloadURL(storageRef);
}
