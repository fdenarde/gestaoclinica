import {
  createDefaultPublicBookingSettings,
  normalizePublicBookingSettings,
  PSYCHOLOGY_SERVICE_CATALOG,
  canonicalPsychologyServiceId,
  psychologyCatalogEntry,
} from './publicBookingServer.bundle.js';
import {
  getAdminDb,
  PUBLIC_BOOKING_FIREBASE_PROJECTS,
  resolvePublicBookingFirebaseProjectId,
} from './firebaseAdmin.js';
import {
  buildPsychologyServerEntity,
  createPsychologyServerRepository,
  psychologyCollectionPath,
} from './psychologyRepository.js';

const STAGING_PROJECT_ID = PUBLIC_BOOKING_FIREBASE_PROJECTS.staging;
const PRODUCTION_PROJECT_ID = PUBLIC_BOOKING_FIREBASE_PROJECTS.production;
const CONTEXT = 'PSICOLOGIA';
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function configurationError(message) {
  const error = new Error(message);
  error.code = 'public-booking/configuration-invalid';
  error.statusCode = 503;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requiredScopeSegment(environment, name) {
  const value = String(environment[name] || '').trim();
  if (!SAFE_SEGMENT_PATTERN.test(value)) throw configurationError(`Configuração obrigatória ausente ou inválida: ${name}`);
  return value;
}

function optionalTestRunId(environment) {
  const value = String(environment.PUBLIC_BOOKING_TEST_RUN_ID || '').trim();
  if (!value) return undefined;
  if (!/^R2F3(?:D|G|I)_[A-Za-z0-9_-]{8,80}$/.test(value)) throw configurationError('PUBLIC_BOOKING_TEST_RUN_ID inválido.');
  return value;
}

export function resolvePublicBookingRuntimeConfig(environment = process.env) {
  const selectedEnvironment = String(environment.PUBLIC_BOOKING_ENVIRONMENT || '').trim();
  let expectedProjectId;
  try {
    expectedProjectId = resolvePublicBookingFirebaseProjectId(selectedEnvironment);
  } catch {
    throw configurationError('PUBLIC_BOOKING_ENVIRONMENT deve ser explicitamente staging ou production.');
  }
  const projectId = String(environment.FIREBASE_PROJECT_ID || '').trim();
  if (!projectId || projectId !== expectedProjectId) {
    throw configurationError('FIREBASE_PROJECT_ID não corresponde ao ambiente público selecionado.');
  }
  const testRun = optionalTestRunId(environment);
  const syntheticFixture = String(environment.PUBLIC_BOOKING_SYNTHETIC_FIXTURE || '').trim().toLowerCase() === 'true';
  if (syntheticFixture && (selectedEnvironment !== 'staging' || !testRun)) {
    throw configurationError('Fixtures sintéticas exigem ambiente staging e PUBLIC_BOOKING_TEST_RUN_ID explícito.');
  }
  if (selectedEnvironment === 'production' && testRun) {
    throw configurationError('PUBLIC_BOOKING_TEST_RUN_ID não pode ser usado no ambiente production.');
  }
  return Object.freeze({
    environment: selectedEnvironment,
    projectId,
    workspaceId: requiredScopeSegment(environment, 'PUBLIC_BOOKING_WORKSPACE_ID'),
    tenantId: requiredScopeSegment(environment, 'PUBLIC_BOOKING_TENANT_ID'),
    professionalId: requiredScopeSegment(environment, 'PUBLIC_BOOKING_PROFESSIONAL_ID'),
    professionalSlug: requiredScopeSegment(environment, 'PUBLIC_BOOKING_PROFESSIONAL_SLUG'),
    professionalName: String(environment.PUBLIC_BOOKING_PROFESSIONAL_NAME || '').trim(),
    testRunId: testRun,
    syntheticFixture,
  });
}

export function assertPublicBookingContext(context) {
  if (String(context || '').trim() !== CONTEXT) {
    throw configurationError('O contexto do agendamento público deve ser PSICOLOGIA.');
  }
  return CONTEXT;
}

function configuredScope(config) {
  return {
    ...config,
  };
}

function syntheticSettings(now, scope) {
  const base = createDefaultPublicBookingSettings(now);
  const locationIds = ['r2f3d-location-a', 'r2f3d-location-b'];
  const locations = [
    {
      id: locationIds[0], professionalId: scope.professionalId, displayName: 'R2F3-D Local A',
      fullAddress: 'Endereço sintético A — Homologação', city: 'Cidade Sintética', state: 'ES',
      googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=R2F3-D+Local+A+Homologacao', active: true, sortOrder: 1,
    },
    {
      id: locationIds[1], professionalId: scope.professionalId, displayName: 'R2F3-D Local B',
      fullAddress: 'Endereço sintético B — Homologação', city: 'Cidade Sintética', state: 'ES',
      googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=R2F3-D+Local+B+Homologacao', active: true, sortOrder: 2,
    },
  ];
  const settings = normalizePublicBookingSettings({
    ...base,
    professionalSlug: scope.professionalSlug,
    professionalName: scope.professionalName || 'Profissional de Homologação',
    clinicDisplayName: 'Gestão Clínica — Staging',
    professionalId: scope.professionalId,
    minNoticeHours: 0,
    maxAdvanceDays: 30,
    whatsappContactPhoneE164: '5511999991234',
    locations,
    publishedServices: base.publishedServices.map(service => ({ ...service, allowedLocationIds: locationIds })),
    publicBookingAvailability: [1, 2, 3, 4, 5].map(dayOfWeek => ({
      dayOfWeek,
      enabled: true,
      startTime: '09:00',
      endTime: '17:00',
      modalities: ['ONLINE', 'PRESENCIAL'],
      locationIds,
    })),
  }, now);
  return {
    ...settings,
    professionalId: scope.professionalId,
    locations: settings.locations.map(location => ({ ...location, professionalId: scope.professionalId })),
    publishedServices: settings.publishedServices.map(service => ({ ...service, allowedLocationIds: locationIds })),
  };
}

function normalizedSettings(value, now, scope) {
  const source = value && typeof value === 'object'
    ? value
    : scope.syntheticFixture
      ? syntheticSettings(now, scope)
      : null;
  if (!source) throw configurationError('O catálogo público não está configurado para o ambiente selecionado.');
  const sourceProfessionalId = String(source.professionalId || '').trim();
  if (sourceProfessionalId && sourceProfessionalId !== scope.professionalId) {
    throw configurationError('O catálogo público pertence a outro profissional.');
  }
  const sourceSlug = String(source.professionalSlug || '').trim();
  if (sourceSlug && sourceSlug !== scope.professionalSlug) {
    throw configurationError('O catálogo público pertence a outro slug profissional.');
  }
  const professionalName = String(source.professionalName || scope.professionalName || '').trim();
  if (!professionalName) throw configurationError('O nome público da profissional não está configurado.');
  const settings = normalizePublicBookingSettings({
    ...source,
    professionalId: scope.professionalId,
    professionalSlug: scope.professionalSlug,
    professionalName,
  }, now);
  return {
    ...settings,
    professionalId: scope.professionalId,
    locations: settings.locations.map(location => ({ ...location, professionalId: scope.professionalId })),
  };
}

function canonicalRuntimeScope(scope) {
  return {
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
    professionalId: scope.professionalId,
    context: CONTEXT,
    authUid: 'public-booking',
  };
}

function canonicalLocationFromPublic(location, scope, index, now) {
  return {
    id: location.id,
    workspaceId: scope.workspaceId,
    professionalId: scope.professionalId,
    tenantId: scope.tenantId,
    context: CONTEXT,
    type: index === 0 ? 'PRIMARY_OFFICE' : 'EXTERNAL_OFFICE',
    displayName: location.displayName,
    address: location.fullAddress,
    fullAddress: location.fullAddress,
    city: location.city,
    state: location.state,
    googleMapsUrl: location.googleMapsUrl,
    sortOrder: location.sortOrder,
    active: location.active,
    isPrimary: index === 0,
    color: '#8B5CF6',
    colorKey: index === 0 ? 'PRESENTIAL_PRIMARY' : 'EXTERNAL_OFFICE',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function canonicalServiceMap(services) {
  const byId = new Map();
  for (const service of services) {
    const canonicalId = canonicalPsychologyServiceId(service?.id);
    if (!psychologyCatalogEntry(canonicalId)) continue;
    const current = byId.get(canonicalId);
    const isExactCanonicalRecord = String(service?.id || '') === canonicalId;
    if (!current || (String(current.id || '') !== canonicalId && isExactCanonicalRecord)) {
      byId.set(canonicalId, { ...service, id: canonicalId });
    }
  }
  return byId;
}

function reconcileCanonicalServices({ remoteServices, settings, locations, scope, now }) {
  const configuredById = new Map(
    settings.publishedServices.map(publication => [canonicalPsychologyServiceId(publication.id), publication]),
  );
  const remoteById = canonicalServiceMap(remoteServices);
  const locationIds = locations.map(location => location.id);
  const defaults = createDefaultPublicBookingSettings(now);
  const defaultById = new Map(defaults.publishedServices.map(service => [service.id, service]));

  return PSYCHOLOGY_SERVICE_CATALOG.map(entry => {
    const remote = remoteById.get(entry.id);
    if (remote) return remote;
    const configured = configuredById.get(entry.id);
    const fallback = defaultById.get(entry.id);
    const publicBooking = {
      active: configured?.active ?? fallback?.active ?? true,
      onlineEnabled: configured?.onlineEnabled ?? fallback?.onlineEnabled ?? entry.modality !== 'PRESENTIAL',
      inPersonEnabled: configured?.inPersonEnabled ?? fallback?.inPersonEnabled ?? entry.modality !== 'ONLINE',
      allowedLocationIds: configured?.allowedLocationIds ?? locationIds,
      sortOrder: configured?.sortOrder ?? fallback?.sortOrder ?? entry.sortOrder,
    };
    return {
      id: entry.id,
      workspaceId: scope.workspaceId,
      tenantId: scope.tenantId,
      professionalId: scope.professionalId,
      context: CONTEXT,
      name: entry.name,
      defaultDurationMinutes: entry.defaultDurationMinutes,
      defaultPrice: entry.defaultPrice,
      modality: entry.modality,
      active: configured?.active !== false,
      publicBooking,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  });
}

function projectSettingsFromCanonical(settings, services, locations, scope) {
  const locationById = new Map(locations.map(location => [location.id, location]));
  const configuredById = new Map(settings.publishedServices.map(publication => [canonicalPsychologyServiceId(publication.id), publication]));
  const canonicalIds = new Set();
  const publishedServices = services
    .filter(source => {
      if (!source?.id || canonicalIds.has(source.id)) return false;
      canonicalIds.add(source.id);
      return true;
    })
    .map((source, index) => {
      const publication = source.publicBooking || {};
      const configured = configuredById.get(source.id);
      const onlineEnabled = publication.onlineEnabled ?? configured?.onlineEnabled ?? source.modality !== 'PRESENTIAL';
      const inPersonEnabled = publication.inPersonEnabled ?? configured?.inPersonEnabled ?? source.modality !== 'ONLINE';
      return {
        id: source.id,
        name: source.name || psychologyCatalogEntry(source.id)?.name || 'Atendimento',
        durationMinutes: Number(source.defaultDurationMinutes) || psychologyCatalogEntry(source.id)?.defaultDurationMinutes || 50,
        active: source.active !== false && (publication.active ?? configured?.active ?? source.active !== false),
        onlineEnabled,
        inPersonEnabled,
        allowedLocationIds: [...(publication.allowedLocationIds ?? configured?.allowedLocationIds ?? locations.map(location => location.id))].filter(id => locationById.has(id)),
        sortOrder: publication.sortOrder ?? configured?.sortOrder ?? psychologyCatalogEntry(source.id)?.sortOrder ?? index + 1,
      };
    })
    .concat(settings.publishedServices
      .filter(publication => !canonicalIds.has(canonicalPsychologyServiceId(publication.id)))
      .map(publication => ({ ...publication, active: false })));
  const projectedLocations = settings.locations.map(location => {
    const source = locationById.get(location.id);
    if (!source) return { ...location, active: false };
    return {
      ...location,
      id: source.id,
      professionalId: scope.professionalId,
      displayName: source.displayName,
      fullAddress: source.fullAddress || source.address || '',
      city: source.city || '',
      state: source.state || '',
      googleMapsUrl: source.googleMapsUrl || '',
      active: source.active,
      sortOrder: source.sortOrder || location.sortOrder,
    };
  });
  return {
    ...normalizePublicBookingSettings({ ...settings, publishedServices, locations: projectedLocations }, new Date(settings.updatedAt || Date.now())),
    professionalId: scope.professionalId,
    professionalSlug: scope.professionalSlug,
    professionalName: settings.professionalName,
    locations: projectedLocations.map(location => ({ ...location, professionalId: scope.professionalId })),
  };
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function appointmentForStorage(appointment) {
  const { mapsNavigationRef: _rawMapsNavigationRef, ...safeAppointment } = appointment;
  return clone(safeAppointment);
}

function capabilityForStorage(capability) {
  return {
    capabilityHash: capability.capabilityHash,
    capabilityType: capability.capabilityType,
    appointmentId: capability.appointmentId,
    context: CONTEXT,
    professionalId: capability.professionalId,
    createdAt: capability.createdAt,
    expiresAt: capability.expiresAt,
    ...(capability.revokedAt ? { revokedAt: capability.revokedAt } : {}),
  };
}

export function createFirestorePublicBookingServerStore(options = {}) {
  const runtimeConfig = resolvePublicBookingRuntimeConfig();
  assertPublicBookingContext(CONTEXT);
  const db = options.db || getAdminDb();
  const scope = configuredScope(runtimeConfig);
  const runId = runtimeConfig.testRunId;
  const root = db.doc(`workspaces/${scope.workspaceId}/tenants/${scope.tenantId}/professionals/${scope.professionalId}/contexts/${CONTEXT}/publicBooking/state`);
  const appointments = root.collection('appointments');
  const capabilities = root.collection('capabilities');
  const nowFactory = options.now || (() => new Date());
  const canonicalScope = canonicalRuntimeScope(scope);
  const canonicalRepository = createPsychologyServerRepository({
      db,
      runtimeScope: canonicalScope,
      now: () => nowFactory().toISOString(),
      requestId: runId || 'public-booking',
      operation: 'public-booking:canonical',
    });

  async function loadCanonicalCatalog(settings, now) {
    const remoteServices = await canonicalRepository.services.list();
    let locations = await canonicalRepository.locations.list();
    if (!locations.length) {
      for (const [index, location] of settings.locations.entries()) {
        await canonicalRepository.locations.upsert(canonicalLocationFromPublic(location, scope, index, now));
      }
      locations = await canonicalRepository.locations.list();
    }
    const services = reconcileCanonicalServices({ remoteServices, settings, locations, scope: canonicalRuntimeScope(scope), now });
    return { settings: projectSettingsFromCanonical(settings, services, locations, scope), services, locations };
  }

  async function loadState() {
    const snapshot = await root.get();
    const raw = snapshot.exists ? snapshot.data() : {};
    if (raw?.testRunId && raw.testRunId !== runId) throw new Error('O escopo remoto já pertence a outro testRunId.');
    const settings = normalizedSettings(raw?.settings, nowFactory(), scope);
    const catalog = await loadCanonicalCatalog(settings, nowFactory());
    const appointmentSnapshot = await appointments.get();
    const appointmentMap = new Map();
    appointmentSnapshot.docs.forEach(document => {
      const value = document.data();
      if (value?.id) appointmentMap.set(value.id, clone(value));
    });
    return { settings: catalog.settings, appointments: appointmentMap, capabilities: new Map() };
  }

  async function saveState(state) {
    const batch = db.batch();
    const updatedAt = nowFactory().toISOString();
    batch.set(root, { schemaVersion: 1, context: CONTEXT, ...(runId ? { testRunId: runId } : {}), settings: clone(state.settings), updatedAt }, { merge: true });
    for (const appointment of state.appointments.values()) batch.set(appointments.doc(appointment.id), appointmentForStorage(appointment));
    for (const capability of state.capabilities.values()) batch.set(capabilities.doc(capability.capabilityHash), capabilityForStorage(capability));
    await batch.commit();
  }

  async function persistCanonicalBooking(state, record) {
    const existingPatients = await canonicalRepository.patients.list();
    const incomingPhone = normalizePhone(record.patient.phone);
    const incomingEmail = normalizeEmail(record.patient.email);
    const incomingName = normalizeEmail(record.patient.name);
    const existing = existingPatients.find(patient => normalizePhone(patient.phone) === incomingPhone
      && (normalizeEmail(patient.email) === incomingEmail || normalizeEmail(patient.name) === incomingName));
    const patientId = existing?.id || record.patient.id;
    const nowIso = nowFactory().toISOString();
    const patient = buildPsychologyServerEntity({
      runtimeScope: canonicalScope,
      aggregate: 'patients',
      entity: {
        ...record.patient,
        id: patientId,
        workspaceId: scope.workspaceId,
        tenantId: scope.tenantId,
        ...(existing?.administrativeNote ? { administrativeNote: existing.administrativeNote } : {}),
        updatedAt: nowIso,
      },
      existing,
      now: () => nowIso,
      requestId: runId || 'public-booking',
      operation: 'public-booking:create-patient',
    });
    const session = buildPsychologyServerEntity({
      runtimeScope: canonicalScope,
      aggregate: 'sessions',
      entity: { ...record.session, patientId, workspaceId: scope.workspaceId, tenantId: scope.tenantId, updatedAt: nowIso },
      existing: undefined,
      now: () => nowIso,
      requestId: runId || 'public-booking',
      operation: 'public-booking:create-session',
    });
    const appointment = { ...record.appointment, patientId };
    state.appointments.set(appointment.id, clone(appointment));
    const rootSnapshot = await root.get();
    const raw = rootSnapshot.exists ? rootSnapshot.data() : {};
    if (raw?.testRunId && raw.testRunId !== runId) throw new Error('O escopo remoto já pertence a outro testRunId.');
    const batch = db.batch();
    batch.set(root, { schemaVersion: 1, context: CONTEXT, ...(runId ? { testRunId: runId } : {}), settings: clone(state.settings), updatedAt: nowIso }, { merge: true });
    for (const currentAppointment of state.appointments.values()) batch.set(appointments.doc(currentAppointment.id), appointmentForStorage(currentAppointment));
    for (const capability of state.capabilities.values()) batch.set(capabilities.doc(capability.capabilityHash), capabilityForStorage(capability));
    batch.set(db.doc(`${psychologyCollectionPath(canonicalScope, 'patients')}/${patient.id}`), patient, { merge: false });
    batch.set(db.doc(`${psychologyCollectionPath(canonicalScope, 'sessions')}/${session.id}`), session, { merge: false });
    await batch.commit();
    return { appointment };
  }

  async function getCapability(capabilityHash) {
    if (!/^[a-f0-9]{64}$/.test(String(capabilityHash || ''))) return null;
    const snapshot = await capabilities.doc(capabilityHash).get();
    if (!snapshot.exists) return null;
    const value = snapshot.data();
    return value?.context === CONTEXT ? capabilityForStorage(value) : null;
  }

  async function getAppointment(appointmentId) {
    const value = await appointments.doc(String(appointmentId || '')).get();
    if (!value.exists || value.data()?.context !== CONTEXT) return null;
    return clone(value.data());
  }

  const store = {
    getState() {
      throw new Error('O armazenamento Firestore exige loadState assíncrono.');
    },
    loadState,
    saveState,
    getCapability,
    getAppointment,
    scope,
    environment: scope.environment,
    projectId: scope.projectId,
    rootPath: root.path,
  };
  store.persistBooking = persistCanonicalBooking;
  return store;
}

export { STAGING_PROJECT_ID, PRODUCTION_PROJECT_ID };
