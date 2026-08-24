import type { PsychologyStore } from '../psychology-pilot/psychologyDomain';

export interface PsychologyBackupData {
  settings: Record<string, unknown>;
  patients: Record<string, unknown>[];
  appointments: Record<string, unknown>[];
  personalAppointments: Record<string, unknown>[];
  services: Record<string, unknown>[];
  locations: Record<string, unknown>[];
  sessionPackages: Record<string, unknown>[];
  charges: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  clinicalRecords: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
}

function pick<T extends Record<string, unknown>>(value: T, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields
    .filter(field => value[field] !== undefined)
    .map(field => [field, value[field]]));
}

function pickNested(value: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const selected = pick(value as Record<string, unknown>, fields);
  return Object.keys(selected).length ? selected : undefined;
}

function pickReferences(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const selected = value
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(item => pick(item as Record<string, unknown>, ['source', 'externalId', 'importedAt']))
    .filter(item => Object.keys(item).length > 0);
  return selected.length ? selected : undefined;
}

function pickSettings(store: PsychologyStore): Record<string, unknown> {
  const profile = store.settings.professionalProfile;
  const agenda = store.settings.agenda;
  return {
    scope: { professionalId: store.scope.professionalId, context: 'PSICOLOGIA' },
    professionalProfile: pick(profile as unknown as Record<string, unknown>, [
      'displayName', 'professionalTitle', 'professionalRegistration', 'clinicDisplayName', 'email', 'phone',
    ]),
    agenda: pick(agenda as unknown as Record<string, unknown>, [
      'defaultDurationMinutes', 'intervalMinutes', 'weeklyAvailability', 'dayParts',
    ]),
    colors: pick(store.settings.colors as unknown as Record<string, unknown>, [
      'ONLINE', 'PRESENTIAL_PRIMARY', 'EXTERNAL_OFFICE', 'PERSONAL', 'MENTORING',
    ]),
    reminders: pick(store.settings.reminders as unknown as Record<string, unknown>, ['enabled', 'advanceMinutes']),
    updatedAt: store.settings.updatedAt,
  };
}

export function selectPsychologyBackupData(store: PsychologyStore): PsychologyBackupData {
  return {
    settings: pickSettings(store),
    patients: store.patients.map(patient => ({ ...pick(patient as unknown as Record<string, unknown>, [
      'id', 'name', 'dateOfBirth', 'birthDate', 'phone', 'additionalPhone', 'email', 'address', 'demographics',
      'migrationReview', 'preferredModality', 'administrativeNote', 'administrativeNotes', 'administrativeResponsible',
      'externalReferences', 'inReview', 'reviewMarkedAt', 'active', 'createdAt', 'updatedAt',
    ]),
      ...(pickNested(patient.address, ['street', 'number', 'postalCode', 'neighborhood', 'city', 'state', 'province', 'country']) ? { address: pickNested(patient.address, ['street', 'number', 'postalCode', 'neighborhood', 'city', 'state', 'province', 'country']) } : {}),
      ...(pickNested(patient.demographics, ['religion', 'education', 'profession', 'nationality']) ? { demographics: pickNested(patient.demographics, ['religion', 'education', 'profession', 'nationality']) } : {}),
      ...(pickNested(patient.migrationReview, ['required', 'reason']) ? { migrationReview: pickNested(patient.migrationReview, ['required', 'reason']) } : {}),
      ...(pickNested(patient.administrativeResponsible, ['fullName', 'relationship', 'phone', 'email']) ? { administrativeResponsible: pickNested(patient.administrativeResponsible, ['fullName', 'relationship', 'phone', 'email']) } : {}),
      ...(pickReferences(patient.externalReferences) ? { externalReferences: pickReferences(patient.externalReferences) } : {}),
    })),
    appointments: store.sessions.map(session => pick(session as unknown as Record<string, unknown>, [
      'id', 'patientId', 'date', 'time', 'durationMinutes', 'modality', 'serviceId', 'locationId', 'locationType',
      'chargeId', 'administrativeNote', 'status', 'canonicalStatus', 'sourceStatus', 'externalSource',
      'externalEventId', 'externalScheduleId', 'bookingOrigin', 'createdAt', 'updatedAt',
    ])),
    personalAppointments: store.personalCommitments.map(item => pick(item as unknown as Record<string, unknown>, [
      'id', 'date', 'time', 'durationMinutes', 'type', 'title', 'note', 'recurrence', 'alarmEnabled',
      'alarmAdvance', 'alarmSound', 'alarmVolume', 'alarmFadeIn', 'isDone', 'createdAt', 'updatedAt',
    ])),
    services: store.services.map(service => pick(service as unknown as Record<string, unknown>, [
      'id', 'name', 'defaultDurationMinutes', 'defaultPrice', 'modality', 'active', 'createdAt', 'updatedAt',
    ])),
    locations: store.locations.map(location => ({ ...pick(location as unknown as Record<string, unknown>, [
      'id', 'type', 'displayName', 'address', 'fullAddress', 'city', 'state', 'googleMapsUrl', 'sortOrder',
      'active', 'isPrimary', 'colorKey', 'color', 'externalReferences', 'createdAt', 'updatedAt',
    ]),
      ...(pickReferences(location.externalReferences) ? { externalReferences: pickReferences(location.externalReferences) } : {}),
    })),
    sessionPackages: store.sessionPackages.map(item => pick(item as unknown as Record<string, unknown>, [
      'id', 'patientId', 'name', 'totalSessions', 'usedSessions', 'startDate', 'endDate', 'active', 'price',
      'createdAt', 'updatedAt',
    ])),
    charges: store.charges.map(charge => pick(charge as unknown as Record<string, unknown>, [
      'id', 'patientId', 'sessionId', 'serviceId', 'packageId', 'description', 'amount', 'dueDate', 'status',
      'createdAt', 'updatedAt', 'cancelledAt', 'cancellationReason', 'exempt', 'exemptionReason',
    ])),
    payments: store.payments.map(payment => pick(payment as unknown as Record<string, unknown>, [
      'id', 'chargeId', 'patientId', 'sessionId', 'amount', 'date', 'method', 'status', 'createdAt', 'updatedAt',
      'reversedAt', 'reversalReason', 'voidedAt', 'operationKey',
    ])),
    expenses: store.expenses.map(expense => pick(expense as unknown as Record<string, unknown>, [
      'id', 'description', 'amount', 'date', 'category', 'status', 'createdAt', 'updatedAt',
    ])),
    clinicalRecords: store.sessionRecords.map(record => pick(record as unknown as Record<string, unknown>, [
      'id', 'patientId', 'sessionId', 'date', 'sessionDate', 'sessionTime', 'authorProfessionalId', 'content',
      'createdAt', 'updatedAt',
    ])),
    documents: store.documents.map(document => pick(document as unknown as Record<string, unknown>, [
      'id', 'patientId', 'category', 'classification', 'filename', 'mimeType', 'size', 'storageRef',
      'externalSource', 'externalId', 'createdAt', 'updatedAt',
    ])),
    attachments: store.attachments.map(attachment => pick(attachment as unknown as Record<string, unknown>, [
      'id', 'patientId', 'documentId', 'sessionRecordId', 'filename', 'mimeType', 'size', 'storageRef',
      'classification', 'externalSource', 'externalId', 'createdAt', 'updatedAt',
    ])),
  };
}
