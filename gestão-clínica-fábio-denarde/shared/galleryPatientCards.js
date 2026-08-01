import { buildActivityMediaPackageModel } from './activityMediaPackages.js';
import {
  dedupeSessionsByStableIdentity,
  normalizePackageConsumptionDecision,
  sessionConsumesPackage,
} from './sessionScheduling.js';

const SESSIONS_PER_PACKAGE = 10;

function normalizeText(value = '') {
  return String(value || '').trim();
}

function comparableText(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function sessionSortKey(session = {}) {
  const rawTime = normalizeText(session?.time);
  const time = /^\d{1,2}:\d{2}$/.test(rawTime)
    ? `${rawTime.split(':')[0].padStart(2, '0')}:${rawTime.split(':')[1]}`
    : '00:00';
  return `${normalizeText(session?.date)}T${time}|${normalizeText(session?.id)}`;
}

function saoPauloDateKey(value = new Date()) {
  const normalized = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(normalized);
}

function responsibleIdentityNames(patient = {}) {
  return new Set([
    patient.guardianName,
    patient.motherName,
    patient.fatherName,
    patient.otherResponsibleName,
    patient.custodyResponsibleName,
    patient.financialResponsibleOtherName,
    patient.responsibleName,
    patient.guardian?.name,
    patient.responsible?.name,
    patient.access?.name,
    patient.access?.displayName,
    patient.user?.name,
    patient.user?.displayName,
  ].map(comparableText).filter(Boolean));
}

export function resolveProfessionalGalleryPatientIdentity(patient = null, fallbackOption = null) {
  if (!patient) {
    return {
      id: normalizeText(fallbackOption?.id),
      name: normalizeText(fallbackOption?.name) || 'Atendente',
      photoUrl: '',
      photoDriveFileId: '',
    };
  }

  const responsibleNames = responsibleIdentityNames(patient);
  const shortName = normalizeText(patient.name);
  const fullName = normalizeText(patient.fullName);
  // `name` é o identificador nominal canônico do atendente no cadastro. O
  // campo opcional `fullName` só participa de cadastros legados sem `name` e
  // nunca pode coincidir com qualquer identidade conhecida do responsável.
  const safeLegacyFullName = fullName && !responsibleNames.has(comparableText(fullName))
    ? fullName
    : '';
  const canonicalName = shortName || safeLegacyFullName || 'Atendente';

  return {
    id: normalizeText(patient.id),
    name: canonicalName,
    photoUrl: normalizeText(patient.photoUrl),
    photoDriveFileId: normalizeText(patient.photoDriveFileId),
  };
}

export function normalizeSessionPackageConsumption(session = {}) {
  const normalizedDecision = normalizePackageConsumptionDecision(session.consumesPackage);
  if (normalizedDecision === null) {
    const { consumesPackage: _ignored, ...withoutInvalidDecision } = session;
    void _ignored;
    return withoutInvalidDecision;
  }
  return {
    ...session,
    consumesPackage: normalizedDecision,
  };
}

export function buildProfessionalGalleryPatientCards({
  patients = [],
  patientOptions = [],
  sessions = [],
  payments = [],
  search = '',
  now = new Date(),
} = {}) {
  const patientList = Array.isArray(patients) ? patients : [];
  const options = Array.isArray(patientOptions) && patientOptions.length > 0
    ? patientOptions
    : patientList.map(patient => ({ id: patient.id, name: patient.name }));
  const patientsById = new Map(
    patientList.map(patient => [normalizeText(patient?.id), patient]),
  );
  const normalizedSearch = comparableText(search);
  const throughDate = saoPauloDateKey(now);

  return options
    .map(option => {
      const optionId = normalizeText(option?.id);
      const patient = patientsById.get(optionId) || null;
      // Quando a coleção local existe, opções órfãs não podem virar cards a
      // partir de perfis de acesso ou identidades de responsáveis.
      if (patientList.length > 0 && !patient) return null;

      const identity = resolveProfessionalGalleryPatientIdentity(patient, option);
      const patientSessions = dedupeSessionsByStableIdentity(sessions)
        .filter(session => normalizeText(session?.patientId) === identity.id);
      const model = buildActivityMediaPackageModel(patientSessions, {
        patientId: identity.id,
        payments,
        packageTolerances: patient?.packageTolerances || [],
        now,
      });
      const consumedTotal = patientSessions.filter(session => sessionConsumesPackage(session, {
        throughDate,
      })).length;
      const currentPackageNumber = model.currentPackageNumber || 1;
      const consumedCount = Math.min(
        SESSIONS_PER_PACKAGE,
        Math.max(0, consumedTotal - ((currentPackageNumber - 1) * SESSIONS_PER_PACKAGE)),
      );
      const latestSession = patientSessions
        .filter(session => !session?.isBlocked)
        .slice()
        .sort((left, right) => sessionSortKey(right).localeCompare(sessionSortKey(left)))[0] || null;

      return {
        ...identity,
        packageNumber: currentPackageNumber,
        consumedCount,
        remainingCount: Math.max(SESSIONS_PER_PACKAGE - consumedCount, 0),
        progressLabel: `${consumedCount}/${SESSIONS_PER_PACKAGE}`,
        latestSessionDate: normalizeText(latestSession?.date),
        hasSessionToday: patientSessions.some(session => (
          normalizeText(session?.date) === throughDate
          && !session?.isBlocked
        )),
      };
    })
    .filter(Boolean)
    .filter(card => !normalizedSearch || comparableText(card.name).includes(normalizedSearch))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }));
}
