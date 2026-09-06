import { getAdminDb } from './firebaseAdmin.js';
import { psychologyCollectionPath } from './psychologyRepository.js';

const PSYCHOLOGY_CONTEXT = 'PSICOLOGIA';
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const SETTINGS_OPERATIONAL_FIELD_PATHS = Object.freeze([
  'settings.services',
  'settings.locations',
  'settings.agenda.defaultDurationMinutes',
  'settings.agenda.intervalMinutes',
]);

export const SETTINGS_PERSONAL_FIELD_PATHS = Object.freeze([
  'settings.professionalProfile.displayName',
  'settings.professionalProfile.professionalTitle',
  'settings.professionalProfile.professionalRegistration',
  'settings.professionalProfile.clinicDisplayName',
  'settings.professionalProfile.email',
  'settings.professionalProfile.phone',
]);

function projectionError(code, message, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

function normalize(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function assertResolvedScope(runtimeScope) {
  if (!runtimeScope || runtimeScope.context !== PSYCHOLOGY_CONTEXT) {
    throw projectionError('psychology/invalid-scope', 'O escopo Psicologia não está resolvido.', 422);
  }
  for (const key of ['workspaceId', 'professionalId', 'tenantId']) {
    const value = normalize(runtimeScope[key]);
    if (!value || value.includes('/') || (key === 'professionalId' && !SAFE_ID_PATTERN.test(value))) {
      throw projectionError('psychology/settings-projection-scope-unavailable', 'O escopo resolvido da Psicologia não está disponível.', 503);
    }
  }
}

function settingsFromSnapshot(snapshot) {
  if (!snapshot?.exists) return null;
  const data = typeof snapshot.data === 'function' ? snapshot.data() : snapshot.data;
  return data?.settings && typeof data.settings === 'object' ? data.settings : {};
}

export function projectPsychologySettingsSnapshot(snapshot) {
  const settings = settingsFromSnapshot(snapshot);
  const services = settings?.services;
  const locations = settings?.locations;
  const agenda = settings?.agenda;
  const settingsFound = Boolean(snapshot?.exists);
  const servicesPresent = Array.isArray(services);
  const locationsPresent = Array.isArray(locations);
  const agendaDefaultsPresent = Number.isFinite(Number(agenda?.defaultDurationMinutes))
    && Number.isFinite(Number(agenda?.intervalMinutes));

  return Object.freeze({
    ok: true,
    settingsFound,
    settingsStructureValid: settingsFound && servicesPresent && locationsPresent && agendaDefaultsPresent,
    servicesPresent,
    servicesCount: servicesPresent ? services.length : 0,
    locationsPresent,
    locationsCount: locationsPresent ? locations.length : 0,
    agendaDefaultsPresent,
  });
}

function errorCode(error) {
  const code = normalize(error?.code, 120);
  return /^[A-Za-z][A-Za-z0-9._/-]*$/.test(code) ? code : 'psychology/settings-projection-failed';
}

function failureLayer(error) {
  const code = errorCode(error).toLowerCase();
  const status = Number(error?.statusCode || error?.status);
  if (code.includes('scope')) return 'SCOPE';
  if (code.includes('permission') || status === 401 || status === 403) return 'PERMISSION';
  if (code.includes('not-found') || status === 404) return 'DOCUMENT_NOT_FOUND';
  if (code.includes('resource-exhausted') || status === 429) return 'QUOTA';
  if (code.includes('parse') || code.includes('shape')) return 'PARSING';
  if (code.includes('runtime') || code.includes('unavailable')) return 'RUNTIME';
  return 'FIRESTORE_READ';
}

export function sanitizePsychologySettingsProjectionError(error) {
  const status = Number(error?.statusCode || error?.status);
  const normalizedStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 503;
  const code = errorCode(error);
  return Object.freeze({
    ok: false,
    errorName: 'PsychologySettingsProjectionError',
    errorCode: code,
    messageSanitized: 'A leitura projetada de Settings não foi concluída.',
    failureLayer: failureLayer(error),
    httpStatus: normalizedStatus,
    resourceExhausted: code.toLowerCase().includes('resource-exhausted') || normalizedStatus === 429,
  });
}

export async function readPsychologySettingsProjection({ db = getAdminDb(), runtimeScope }) {
  assertResolvedScope(runtimeScope);
  if (typeof db?.collection !== 'function' || typeof db?.getAll !== 'function') {
    throw projectionError(
      'psychology/settings-projection-runtime-unavailable',
      'O runtime Firestore não expôs leitura projetada.',
      503,
    );
  }

  const settingsReference = db
    .collection(psychologyCollectionPath(runtimeScope, 'settings'))
    .doc('settings');
  const snapshots = await db.getAll(settingsReference, {
    fieldMask: [...SETTINGS_OPERATIONAL_FIELD_PATHS],
  });
  if (!Array.isArray(snapshots) || snapshots.length !== 1) {
    throw projectionError(
      'psychology/settings-projection-invalid-response',
      'O runtime Firestore retornou uma resposta de projeção inválida.',
      502,
    );
  }
  return projectPsychologySettingsSnapshot(snapshots[0]);
}
