import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin.js';
import { assertActivityPatientAccess } from './accessContext.js';
import {
  GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION,
  GOOGLE_PHOTOS_ALBUM_PACKAGE_SCHEMA_VERSION,
  GOOGLE_PHOTOS_PROVIDER,
  buildGooglePhotosAlbumGroupKey,
  buildGooglePhotosAlbumPackageKey,
  filterGooglePhotosAlbumsForViewer,
  getGooglePhotosAlbumCapabilities,
  isSafeGooglePhotosAlbumDate,
  normalizeGooglePhotosAlbumStatus,
  normalizeGooglePhotosAlbumUrl,
  normalizeGooglePhotosCategory,
  normalizeGooglePhotosPackageNumber,
  normalizeGooglePhotosSessionIds,
} from '../../shared/googlePhotosAlbums.js';
import { buildActivityMediaPackageModel } from '../../shared/activityMediaPackages.js';
import { getActivatedPackageNumber } from '../../shared/packagePayments.js';

const MAX_CARDS_PER_PACKAGE = 24;
const MAX_PATIENTS = 500;
const MAX_SESSIONS_PER_PATIENT = 500;
const MAX_PAYMENTS_PER_PATIENT = 200;
const MAX_TITLE_LENGTH = 120;
const MAX_OBSERVATION_LENGTH = 1000;

function albumError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function sanitizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function serializeDate(value) {
  if (value?.toDate instanceof Function) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

function normalizeTime(value) {
  const time = sanitizeText(value, 5);
  return /^\d{2}:\d{2}$/.test(time) ? time : '';
}

function normalizeSessionSortKey(session) {
  return `${sanitizeText(session?.date, 10)}T${normalizeTime(session?.time) || '00:00'}|${String(session?.id || '')}`;
}

function todayIsoDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function packageCollection(context) {
  return getAdminDb().collection(`users/${context.ownerUserId}/${GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION}`);
}

function packageRef(context, patientId, packageNumber) {
  const packageKey = buildGooglePhotosAlbumPackageKey({ patientId, packageNumber });
  if (!packageKey) {
    throw albumError('google-photos-albums/invalid-package', 'Não foi possível identificar o pacote da galeria.');
  }
  return packageCollection(context).doc(packageKey);
}

function effectiveRole(context) {
  return context.activeContext === 'monitoring' ? 'monitoring' : context.role;
}

function assertCapability(context, capability, scope = 'manage') {
  const capabilities = getGooglePhotosAlbumCapabilities({
    role: context.role,
    activeContext: context.activeContext,
    scope,
  });
  if (!capabilities[capability]) {
    throw albumError(
      'google-photos-albums/permission-denied',
      'Seu perfil não está autorizado para realizar esta operação.',
      403,
    );
  }
  return capabilities;
}

function serializeAlbumCard(rawCard, fallback = {}) {
  const card = rawCard && typeof rawCard === 'object' ? rawCard : {};
  const patientId = sanitizeText(card.patientId || fallback.patientId, 160);
  const packageNumber = normalizeGooglePhotosPackageNumber(card.packageNumber || fallback.packageNumber);
  const packageKey = sanitizeText(
    card.packageKey || fallback.packageKey || buildGooglePhotosAlbumPackageKey({ patientId, packageNumber }),
    220,
  );
  const sessionIds = normalizeGooglePhotosSessionIds(card.sessionIds);
  const activityDate = sanitizeText(card.activityDate, 10);
  const sessionGroupKey = sanitizeText(
    card.sessionGroupKey || buildGooglePhotosAlbumGroupKey({ patientId, activityDate, sessionIds }),
    700,
  );
  return {
    id: sanitizeText(card.id || sessionGroupKey, 700),
    schemaVersion: GOOGLE_PHOTOS_ALBUM_PACKAGE_SCHEMA_VERSION,
    provider: GOOGLE_PHOTOS_PROVIDER,
    packageKey,
    packageNumber,
    patientId,
    patientName: sanitizeText(card.patientName || fallback.patientName, 160),
    source: sessionIds.length > 0 ? 'session' : 'date',
    sessionId: sanitizeText(card.sessionId || sessionIds[0], 160) || null,
    sessionIds,
    sessionGroupKey,
    activityDate,
    sessionTime: normalizeTime(card.sessionTime) || null,
    sessionNumbers: Array.isArray(card.sessionNumbers)
      ? [...new Set(card.sessionNumbers.map(Number).filter(value => Number.isFinite(value) && value > 0))].sort((a, b) => a - b)
      : [],
    title: sanitizeText(card.title, MAX_TITLE_LENGTH),
    category: normalizeGooglePhotosCategory(card.category),
    url: normalizeGooglePhotosAlbumUrl(card.url) || '',
    visibleToGuardian: card.visibleToGuardian === true,
    observation: sanitizeText(card.observation, MAX_OBSERVATION_LENGTH),
    publishedAt: sanitizeText(card.publishedAt, 10),
    status: normalizeGooglePhotosAlbumStatus(card.status) === 'removed' ? 'hidden' : normalizeGooglePhotosAlbumStatus(card.status),
    createdByUserId: sanitizeText(card.createdByUserId, 160),
    createdByName: sanitizeText(card.createdByName, 160),
    createdAt: serializeDate(card.createdAt),
    updatedByUserId: sanitizeText(card.updatedByUserId, 160),
    updatedByName: sanitizeText(card.updatedByName, 160),
    updatedAt: serializeDate(card.updatedAt),
    hiddenAt: serializeDate(card.hiddenAt),
    reactivatedAt: serializeDate(card.reactivatedAt),
  };
}

function serializePackage(snapshot, fallback = {}) {
  const data = snapshot?.exists ? snapshot.data() || {} : {};
  const patientId = sanitizeText(data.patientId || fallback.patientId, 160);
  const packageNumber = normalizeGooglePhotosPackageNumber(data.packageNumber || fallback.packageNumber);
  const packageKey = sanitizeText(
    data.packageKey || snapshot?.id || buildGooglePhotosAlbumPackageKey({ patientId, packageNumber }),
    220,
  );
  const cardsMap = data.cards && typeof data.cards === 'object' ? data.cards : {};
  const cards = Object.values(cardsMap)
    .map(card => serializeAlbumCard(card, {
      patientId,
      patientName: data.patientName || fallback.patientName,
      packageKey,
      packageNumber,
    }))
    .filter(card => card.sessionGroupKey && card.url);
  return {
    id: packageKey,
    schemaVersion: GOOGLE_PHOTOS_ALBUM_PACKAGE_SCHEMA_VERSION,
    provider: GOOGLE_PHOTOS_PROVIDER,
    packageKey,
    packageNumber,
    patientId,
    patientName: sanitizeText(data.patientName || fallback.patientName, 160),
    packageStartDate: sanitizeText(data.packageStartDate, 10),
    packageEndDate: sanitizeText(data.packageEndDate, 10),
    cards,
    createdAt: serializeDate(data.createdAt),
    updatedAt: serializeDate(data.updatedAt),
    updatedByUserId: sanitizeText(data.updatedByUserId, 160),
    updatedByName: sanitizeText(data.updatedByName, 160),
  };
}

async function getPatient(context, patientId) {
  const normalizedPatientId = assertActivityPatientAccess(context, patientId);
  const snapshot = await getAdminDb().doc(`users/${context.ownerUserId}/patients/${normalizedPatientId}`).get();
  if (!snapshot.exists) {
    throw albumError('google-photos-albums/patient-not-found', 'O atendente informado não foi encontrado.', 404);
  }
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    name: sanitizeText(data.fullName || data.name, 160) || 'Atendente',
    data,
  };
}

async function listPatientSessions(context, patientId) {
  const snapshot = await getAdminDb().collection(`users/${context.ownerUserId}/sessions`)
    .where('patientId', '==', patientId)
    .limit(MAX_SESSIONS_PER_PATIENT)
    .get();
  return snapshot.docs
    .map(item => ({ id: item.id, ...(item.data() || {}) }))
    .filter(session => !session.isBlocked && isSafeGooglePhotosAlbumDate(session.date))
    .sort((left, right) => normalizeSessionSortKey(left).localeCompare(normalizeSessionSortKey(right)));
}

async function listPatientPayments(context, patientId) {
  const snapshot = await getAdminDb().collection(`users/${context.ownerUserId}/payments`)
    .where('patientId', '==', patientId)
    .limit(MAX_PAYMENTS_PER_PATIENT)
    .get();
  return snapshot.docs.map(item => ({ id: item.id, ...(item.data() || {}) }));
}

function resolvePackageForSave(sessions, payments, patientId, packageNumber) {
  const model = buildActivityMediaPackageModel(sessions, { patientId, payments });
  const targetPackageNumber = normalizeGooglePhotosPackageNumber(packageNumber);
  if (!targetPackageNumber) {
    throw albumError('google-photos-albums/invalid-package', 'Informe um pacote válido para salvar os links.');
  }
  if (targetPackageNumber !== model.currentPackageNumber) {
    throw albumError(
      'google-photos-albums/current-package-only',
      'Somente o pacote atual pode receber novos links nesta galeria.',
      409,
    );
  }
  const targetPackage = model.packages.find(pkg => pkg.number === targetPackageNumber);
  const selectableSessions = (targetPackage?.sessions || []).filter(session => session.selectableForMedia);
  return {
    model,
    targetPackage: targetPackage || {
      number: targetPackageNumber,
      status: 'current',
      sessions: [],
      startDate: '',
      endDate: '',
    },
    selectableSessions,
    selectableById: new Map(selectableSessions.map(session => [String(session.id), session])),
  };
}

function buildExistingCardMap(packageSnapshot) {
  if (!packageSnapshot?.exists) return new Map();
  const cards = packageSnapshot.data()?.cards;
  if (!cards || typeof cards !== 'object') return new Map();
  return new Map(Object.values(cards).map(card => {
    const serialized = serializeAlbumCard(card, {
      patientId: packageSnapshot.data()?.patientId,
      packageNumber: packageSnapshot.data()?.packageNumber,
      packageKey: packageSnapshot.id,
      patientName: packageSnapshot.data()?.patientName,
    });
    return [serialized.sessionGroupKey, card];
  }));
}

function normalizePackageCardInput({
  context,
  card,
  patient,
  packageKey,
  packageNumber,
  existingByGroupKey,
  selectableById,
  permissions,
  now,
}) {
  const rawUrl = sanitizeText(card?.url, 2048);
  if (!rawUrl) return null;
  const url = normalizeGooglePhotosAlbumUrl(rawUrl);
  if (!url) {
    throw albumError(
      'google-photos-albums/invalid-url',
      'Informe um link HTTPS legítimo do Google Fotos.',
    );
  }

  const sessionIds = normalizeGooglePhotosSessionIds(card?.sessionIds);
  if (sessionIds.length === 0) {
    throw albumError(
      'google-photos-albums/missing-session-binding',
      'Cada card salvo precisa estar vinculado a uma ou mais sessões do pacote atual.',
    );
  }

  const selectedSessions = sessionIds.map(sessionId => selectableById.get(sessionId));
  if (selectedSessions.some(session => !session)) {
    throw albumError(
      'google-photos-albums/invalid-session-binding',
      'Os cards só podem usar sessões realizadas ou em andamento do pacote atual do atendente.',
      409,
    );
  }
  const dates = [...new Set(selectedSessions.map(session => sanitizeText(session.date, 10)))];
  if (dates.length !== 1 || !isSafeGooglePhotosAlbumDate(dates[0])) {
    throw albumError(
      'google-photos-albums/invalid-session-binding',
      'Sessões agrupadas no mesmo card precisam pertencer à mesma data.',
      409,
    );
  }

  const activityDate = dates[0];
  const sessionGroupKey = buildGooglePhotosAlbumGroupKey({
    patientId: patient.id,
    activityDate,
    sessionIds,
  });
  if (!sessionGroupKey) {
    throw albumError('google-photos-albums/invalid-group', 'Não foi possível relacionar o card à atividade.');
  }

  const title = sanitizeText(card?.title, MAX_TITLE_LENGTH);
  if (!title) throw albumError('google-photos-albums/missing-title', 'Informe o título do card.');

  const publishedAt = sanitizeText(card?.publishedAt || activityDate, 10);
  if (!isSafeGooglePhotosAlbumDate(publishedAt)) {
    throw albumError('google-photos-albums/invalid-published-date', 'Informe uma data de publicação válida.');
  }

  const existing = existingByGroupKey.get(sessionGroupKey) || null;
  const requestedStatus = normalizeGooglePhotosAlbumStatus(card?.status);
  const existingStatus = existing ? normalizeGooglePhotosAlbumStatus(existing.status) : 'active';
  const status = requestedStatus === 'hidden' && permissions.canHide
    ? 'hidden'
    : existingStatus === 'hidden' && !permissions.canReactivate
      ? 'hidden'
      : 'active';
  const sortedSessions = selectedSessions
    .slice()
    .sort((left, right) => normalizeSessionSortKey(left).localeCompare(normalizeSessionSortKey(right)));
  const sessionNumbers = [...new Set(sortedSessions
    .map(session => Number(session.activitySessionNumber ?? session.packageNumber))
    .filter(value => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b);

  return {
    id: sessionGroupKey,
    schemaVersion: GOOGLE_PHOTOS_ALBUM_PACKAGE_SCHEMA_VERSION,
    provider: GOOGLE_PHOTOS_PROVIDER,
    packageKey,
    packageNumber,
    patientId: patient.id,
    patientName: patient.name,
    source: 'session',
    sessionId: sessionIds[0] || null,
    sessionIds,
    sessionGroupKey,
    activityDate,
    sessionTime: normalizeTime(sortedSessions[0]?.time) || null,
    sessionNumbers,
    title,
    category: normalizeGooglePhotosCategory(card?.category),
    url,
    visibleToGuardian: card?.visibleToGuardian === true,
    observation: sanitizeText(card?.observation, MAX_OBSERVATION_LENGTH),
    publishedAt,
    status,
    createdByUserId: sanitizeText(existing?.createdByUserId || context.userId, 160),
    createdByName: sanitizeText(existing?.createdByName || context.actorName, 160),
    createdAt: existing?.createdAt || now,
    updatedByUserId: context.userId,
    updatedByName: context.actorName,
    updatedAt: now,
    hiddenAt: status === 'hidden'
      ? (existingStatus === 'hidden' ? existing?.hiddenAt || now : now)
      : null,
    reactivatedAt: status === 'active' && existingStatus === 'hidden'
      ? now
      : existing?.reactivatedAt || null,
  };
}

function monitoringStartToDate(value) {
  if (!value) return '';
  const date = value?.toDate instanceof Function ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
}

async function getMonitoringStartDate(context) {
  const snapshot = await getAdminDb().doc(`users/${context.ownerUserId}/settings/config`).get();
  return monitoringStartToDate(snapshot.exists ? snapshot.data()?.activityMediaMonitoringStart : null);
}

export async function listGooglePhotosAlbums(context, { patientId, packageNumber, scope = 'manage' } = {}) {
  const normalizedScope = scope === 'portal' ? 'portal' : 'manage';
  const capabilities = assertCapability(context, 'canView', normalizedScope);
  const normalizedPatientId = assertActivityPatientAccess(context, patientId);
  const normalizedPackageNumber = normalizeGooglePhotosPackageNumber(packageNumber);
  if (!normalizedPackageNumber) {
    throw albumError('google-photos-albums/invalid-package', 'Informe o pacote da galeria.');
  }

  if (normalizedScope === 'portal' && !['responsible', 'admin'].includes(effectiveRole(context))) {
    throw albumError('google-photos-albums/portal-scope-denied', 'Este modo de visualização não está disponível para o seu perfil.', 403);
  }

  let activatedPackageNumber = null;
  let paymentQueryCount = 0;
  if (normalizedScope === 'portal') {
    const payments = await listPatientPayments(context, normalizedPatientId);
    activatedPackageNumber = getActivatedPackageNumber(payments, { patientId: normalizedPatientId });
    paymentQueryCount = 1;
    if (normalizedPackageNumber > activatedPackageNumber) {
      return {
        albums: [],
        ownerUserId: context.ownerUserId,
        packageKey: buildGooglePhotosAlbumPackageKey({ patientId: normalizedPatientId, packageNumber: normalizedPackageNumber }),
        packageNumber: normalizedPackageNumber,
        activatedPackageNumber,
        permissions: capabilities,
        queryCount: paymentQueryCount,
        readUpperBound: MAX_PAYMENTS_PER_PATIENT,
        scope: normalizedScope,
      };
    }
  }

  const ref = packageRef(context, normalizedPatientId, normalizedPackageNumber);
  const snapshot = await ref.get();
  const pkg = serializePackage(snapshot, {
    patientId: normalizedPatientId,
    packageNumber: normalizedPackageNumber,
    packageKey: ref.id,
  });

  const viewerRole = effectiveRole(context);
  const monitoringStartDate = viewerRole === 'monitoring'
    ? await getMonitoringStartDate(context)
    : '';
  const albums = filterGooglePhotosAlbumsForViewer(pkg.cards, {
    patientId: normalizedPatientId,
    packageNumber: normalizedPackageNumber,
    role: context.role,
    activeContext: context.activeContext,
    scope: normalizedScope,
    monitoringStartDate,
  }).sort((left, right) => (
    `${right.activityDate}|${right.publishedAt}|${right.updatedAt || ''}`
      .localeCompare(`${left.activityDate}|${left.publishedAt}|${left.updatedAt || ''}`)
  ));

  return {
    albums,
    ownerUserId: context.ownerUserId,
    packageKey: ref.id,
    packageNumber: normalizedPackageNumber,
    activatedPackageNumber,
    permissions: capabilities,
    queryCount: (viewerRole === 'monitoring' ? 2 : 1) + paymentQueryCount,
    readUpperBound: (viewerRole === 'monitoring' ? 2 : 1) + (paymentQueryCount ? MAX_PAYMENTS_PER_PATIENT : 0),
    scope: normalizedScope,
  };
}

export async function saveGooglePhotosAlbumPackage(context, input) {
  const permissions = assertCapability(context, 'canEdit');
  const patient = await getPatient(context, input?.patientId);
  const packageNumber = normalizeGooglePhotosPackageNumber(input?.packageNumber);
  const ref = packageRef(context, patient.id, packageNumber);
  const [sessions, payments, existingSnapshot] = await Promise.all([
    listPatientSessions(context, patient.id),
    listPatientPayments(context, patient.id),
    ref.get(),
  ]);
  const packageContext = resolvePackageForSave(sessions, payments, patient.id, packageNumber);
  const existingByGroupKey = buildExistingCardMap(existingSnapshot);
  const packageKey = ref.id;
  const now = FieldValue.serverTimestamp();
  const cards = Array.isArray(input?.cards) ? input.cards.slice(0, MAX_CARDS_PER_PACKAGE) : [];
  const normalizedCards = [];
  const seenGroups = new Set();

  for (const card of cards) {
    const normalized = normalizePackageCardInput({
      context,
      card,
      patient,
      packageKey,
      packageNumber,
      existingByGroupKey,
      selectableById: packageContext.selectableById,
      permissions,
      now,
    });
    if (!normalized) continue;
    if (seenGroups.has(normalized.sessionGroupKey)) {
      throw albumError(
        'google-photos-albums/duplicate-group',
        'Há mais de um card com link para a mesma sessão ou grupo de sessões.',
        409,
      );
    }
    seenGroups.add(normalized.sessionGroupKey);
    normalizedCards.push(normalized);
  }

  if (normalizedCards.length === 0) {
    if (existingSnapshot.exists) await ref.delete();
    return {
      albums: [],
      ownerUserId: context.ownerUserId,
      packageKey,
      packageNumber,
      permissions,
      queryCount: 3,
      readUpperBound: MAX_SESSIONS_PER_PATIENT + MAX_PAYMENTS_PER_PATIENT + 2,
      scope: 'manage',
    };
  }

  const cardsMap = Object.fromEntries(normalizedCards.map(card => [card.sessionGroupKey, card]));
  const packageSessions = packageContext.targetPackage.sessions || [];
  await ref.set({
    id: packageKey,
    schemaVersion: GOOGLE_PHOTOS_ALBUM_PACKAGE_SCHEMA_VERSION,
    provider: GOOGLE_PHOTOS_PROVIDER,
    packageKey,
    patientId: patient.id,
    patientName: patient.name,
    packageNumber,
    packageStartDate: packageContext.targetPackage.startDate || packageSessions[0]?.date || '',
    packageEndDate: packageContext.targetPackage.endDate || packageSessions.at(-1)?.date || '',
    cards: cardsMap,
    createdAt: existingSnapshot.exists ? existingSnapshot.data()?.createdAt || now : now,
    updatedAt: now,
    updatedByUserId: context.userId,
    updatedByName: context.actorName,
  });

  const saved = serializePackage(await ref.get(), {
    patientId: patient.id,
    patientName: patient.name,
    packageKey,
    packageNumber,
  });
  return {
    albums: filterGooglePhotosAlbumsForViewer(saved.cards, {
      patientId: patient.id,
      packageNumber,
      role: context.role,
      activeContext: context.activeContext,
      scope: 'manage',
    }),
    ownerUserId: context.ownerUserId,
    packageKey,
    packageNumber,
    permissions,
    queryCount: 3,
    readUpperBound: MAX_SESSIONS_PER_PATIENT + MAX_PAYMENTS_PER_PATIENT + 2,
    scope: 'manage',
  };
}

export async function listGooglePhotosAlbumPatientOptions(context) {
  assertCapability(context, 'canView', 'manage');
  const db = getAdminDb();
  let snapshots;
  if (context.role === 'admin') {
    snapshots = (await db.collection(`users/${context.ownerUserId}/patients`).limit(MAX_PATIENTS).get()).docs;
  } else {
    const ids = Array.isArray(context.allowedPatientIds) ? context.allowedPatientIds.slice(0, 200) : [];
    if (ids.length === 0) return { patients: [], readUpperBound: 0 };
    snapshots = await db.getAll(...ids.map(patientId => db.doc(`users/${context.ownerUserId}/patients/${patientId}`)));
  }

  const patients = snapshots
    .filter(snapshot => snapshot.exists)
    .map(snapshot => {
      const data = snapshot.data() || {};
      return {
        id: snapshot.id,
        name: sanitizeText(data.fullName || data.name, 160) || 'Atendente',
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  return { patients, readUpperBound: context.role === 'admin' ? MAX_PATIENTS : patients.length };
}

export async function listGooglePhotosAlbumSessionOptions(context, patientId) {
  assertCapability(context, 'canView', 'manage');
  const normalizedPatientId = assertActivityPatientAccess(context, patientId);
  const sessions = await listPatientSessions(context, normalizedPatientId);
  return {
    sessions: sessions.map(session => ({
      id: session.id,
      patientId: normalizedPatientId,
      date: sanitizeText(session.date, 10),
      time: normalizeTime(session.time),
      type: sanitizeText(session.type, 80),
      status: sanitizeText(session.status, 40),
      packageNumber: Number.isFinite(Number(session.packageNumber)) ? Number(session.packageNumber) : null,
      isBlocked: false,
      consumesPackage: session.consumesPackage === true,
      source: sanitizeText(session.source, 40),
    })),
    queryCount: 1,
    readUpperBound: MAX_SESSIONS_PER_PATIENT,
  };
}
