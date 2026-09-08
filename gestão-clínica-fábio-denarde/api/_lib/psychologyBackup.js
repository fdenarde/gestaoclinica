import crypto from 'node:crypto';

const BACKUP_APPLICATION_VERSION = '1.7.0';
const BACKUP_SOURCE = 'psychology-remote';
const BACKUP_CONTEXT = 'PSICOLOGIA';

function pick(value, fields) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(fields
    .filter(field => source[field] !== undefined)
    .map(field => [field, source[field]]));
}
function pickNested(value, fields) {
  const selected = pick(value, fields);
  return Object.keys(selected).length ? selected : undefined;
}

function pickReferences(value) {
  if (!Array.isArray(value)) return undefined;
  const selected = value
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(item => pick(item, ['source', 'externalId', 'importedAt']))
    .filter(item => Object.keys(item).length > 0);
  return selected.length ? selected : undefined;
}

function pickPatient(value) {
  return {
    ...pick(value, [
      'id', 'name', 'dateOfBirth', 'birthDate', 'phone', 'additionalPhone', 'email', 'address', 'demographics',
      'migrationReview', 'preferredModality', 'administrativeNote', 'administrativeNotes', 'administrativeResponsible',
      'externalReferences', 'inReview', 'reviewMarkedAt', 'active', 'createdAt', 'updatedAt',
    ]),
    ...(pickNested(value?.address, ['street', 'number', 'postalCode', 'neighborhood', 'city', 'state', 'province', 'country'])
      ? { address: pickNested(value.address, ['street', 'number', 'postalCode', 'neighborhood', 'city', 'state', 'province', 'country']) }
      : {}),
    ...(pickNested(value?.demographics, ['religion', 'education', 'profession', 'nationality'])
      ? { demographics: pickNested(value.demographics, ['religion', 'education', 'profession', 'nationality']) }
      : {}),
    ...(pickNested(value?.migrationReview, ['required', 'reason'])
      ? { migrationReview: pickNested(value.migrationReview, ['required', 'reason']) }
      : {}),
    ...(pickNested(value?.administrativeResponsible, ['fullName', 'relationship', 'phone', 'email'])
      ? { administrativeResponsible: pickNested(value.administrativeResponsible, ['fullName', 'relationship', 'phone', 'email']) }
      : {}),
    ...(pickReferences(value?.externalReferences) ? { externalReferences: pickReferences(value.externalReferences) } : {}),
  };
}

function pickSettings(record, scope) {
  const settings = record?.settings && typeof record.settings === 'object' ? record.settings : {};
  return {
    scope: { professionalId: scope.professionalId, context: BACKUP_CONTEXT },
    professionalProfile: pick(settings.professionalProfile, [
      'displayName', 'professionalTitle', 'professionalRegistration', 'clinicDisplayName', 'email', 'phone',
    ]),
    agenda: pick(settings.agenda, ['defaultDurationMinutes', 'intervalMinutes', 'weeklyAvailability', 'dayParts']),
    colors: pick(settings.colors, ['ONLINE', 'PRESENTIAL_PRIMARY', 'EXTERNAL_OFFICE', 'PERSONAL', 'MENTORING']),
    reminders: pick(settings.reminders, ['enabled', 'advanceMinutes']),
    updatedAt: record?.updatedAt || settings.updatedAt,
  };
}

function selectBackupData({ scope, settings, patients, sessions, personalAppointments, services, locations, sessionPackages, charges, payments, expenses, sessionRecords, documents, attachments }) {
  return {
    settings: pickSettings(settings, scope),
    patients: (patients || []).map(pickPatient),
    appointments: (sessions || []).map(item => pick(item, [
      'id', 'patientId', 'date', 'time', 'durationMinutes', 'modality', 'serviceId', 'locationId', 'locationType',
      'chargeId', 'administrativeNote', 'status', 'canonicalStatus', 'sourceStatus', 'externalSource',
      'externalEventId', 'externalScheduleId', 'bookingOrigin', 'createdAt', 'updatedAt',
    ])),
    personalAppointments: (personalAppointments || []).map(item => pick(item, [
      'id', 'date', 'time', 'durationMinutes', 'type', 'title', 'note', 'recurrence', 'alarmEnabled',
      'alarmAdvance', 'alarmSound', 'alarmVolume', 'alarmFadeIn', 'isDone', 'createdAt', 'updatedAt',
    ])),
    services: (services || []).map(item => pick(item, ['id', 'name', 'defaultDurationMinutes', 'defaultPrice', 'modality', 'active', 'createdAt', 'updatedAt'])),
    locations: (locations || []).map(item => ({
      ...pick(item, ['id', 'type', 'displayName', 'address', 'fullAddress', 'city', 'state', 'googleMapsUrl', 'sortOrder', 'active', 'isPrimary', 'colorKey', 'color', 'externalReferences', 'createdAt', 'updatedAt']),
      ...(pickReferences(item?.externalReferences) ? { externalReferences: pickReferences(item.externalReferences) } : {}),
    })),
    sessionPackages: (sessionPackages || []).map(item => pick(item, [
      'id', 'patientId', 'name', 'serviceId', 'totalSessions', 'usedSessions', 'startDate', 'endDate', 'active', 'price', 'pricePerSession', 'totalPrice', 'createdAt', 'updatedAt',
    ])),
    charges: (charges || []).map(item => pick(item, [
      'id', 'patientId', 'sessionId', 'serviceId', 'packageId', 'description', 'amount', 'dueDate', 'status',
      'createdAt', 'updatedAt', 'cancelledAt', 'cancellationReason', 'reactivatedAt', 'reactivatedBy', 'exempt', 'exemptionReason',
    ])),
    payments: (payments || []).map(item => pick(item, [
      'id', 'chargeId', 'patientId', 'sessionId', 'amount', 'date', 'method', 'status', 'createdAt', 'updatedAt',
      'reversedAt', 'reversalReason', 'voidedAt', 'reactivatedAt', 'reactivatedBy', 'operationKey',
    ])),
    expenses: (expenses || []).map(item => pick(item, ['id', 'description', 'amount', 'date', 'category', 'status', 'createdAt', 'updatedAt'])),
    clinicalRecords: (sessionRecords || []).map(item => pick(item, [
      'id', 'patientId', 'sessionId', 'date', 'sessionDate', 'sessionTime', 'authorProfessionalId', 'content', 'createdAt', 'updatedAt',
    ])),
    documents: (documents || []).map(item => pick(item, [
      'id', 'patientId', 'category', 'classification', 'filename', 'mimeType', 'size', 'storageRef', 'externalSource', 'externalId', 'createdAt', 'updatedAt',
    ])),
    attachments: (attachments || []).map(item => pick(item, [
      'id', 'patientId', 'documentId', 'sessionRecordId', 'filename', 'mimeType', 'size', 'storageRef', 'classification', 'externalSource', 'externalId', 'createdAt', 'updatedAt',
    ])),
  };
}

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function section(path, entity, value) {
  const bytes = jsonBytes(value);
  return { path, entity, value, bytes, count: Array.isArray(value) ? value.length : 1 };
}

function backupFileName(generatedAt) {
  return `backup-psicologia-${generatedAt.slice(0, 10)}-${generatedAt.slice(11, 16).replace(':', '')}.json`;
}

export function buildScopedPsychologyBackup({ scope, records, generatedAt }) {
  if (!scope || scope.context !== BACKUP_CONTEXT || !scope.workspaceId || !scope.professionalId) {
    throw new Error('O escopo autenticado da Psicologia é obrigatório para gerar o backup.');
  }
  const data = selectBackupData({ scope, ...(records || {}) });
  const values = [
    section('patients.json', 'patients', data.patients),
    section('appointments.json', 'appointments', data.appointments),
    section('personal-appointments.json', 'personalAppointments', data.personalAppointments),
    section('services.json', 'services', data.services),
    section('locations.json', 'locations', data.locations),
    section('session-packages.json', 'sessionPackages', data.sessionPackages),
    section('financial/charges.json', 'charges', data.charges),
    section('financial/payments.json', 'payments', data.payments),
    section('financial/expenses.json', 'expenses', data.expenses),
    section('clinical/session-records.json', 'clinicalRecords', data.clinicalRecords),
    section('documents/manifest.json', 'documents', data.documents),
    section('attachments/manifest.json', 'attachments', data.attachments),
    section('settings.json', 'settings', data.settings),
  ];
  const sections = values.map(item => ({
    path: item.path,
    entity: item.entity,
    count: item.count,
    bytes: item.bytes.byteLength,
    sha256: sha256Hex(item.bytes),
  }));
  const manifest = {
    format: 'Gestao-Clinica-Backup',
    version: 2,
    createdAt: generatedAt,
    generatedAt,
    applicationVersion: BACKUP_APPLICATION_VERSION,
    professionalId: scope.professionalId,
    workspaceId: scope.workspaceId,
    context: BACKUP_CONTEXT,
    timezone: 'America/Sao_Paulo',
    sections,
    fileCount: sections.length + 1,
    checksumAlgorithm: 'SHA-256',
    source: BACKUP_SOURCE,
  };
  const fileValues = Object.fromEntries(values.map(item => [item.path, item.value]));
  return {
    fileName: backupFileName(generatedAt),
    json: JSON.stringify({ manifest, files: fileValues }, null, 2),
    source: BACKUP_SOURCE,
    counts: Object.fromEntries(values.map(item => [item.path, item.count])),
    scope: { workspaceId: scope.workspaceId, professionalId: scope.professionalId, context: BACKUP_CONTEXT },
  };
}
