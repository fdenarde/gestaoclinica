import crypto from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin.js';
import { assertActivityPatientAccess } from './accessContext.js';
import {
  GOOGLE_PHOTOS_ALBUM_CREATION_COLLECTION,
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
import { getHighestRecordedTolerancePackageNumber } from '../../shared/packageTolerance.js';
import { normalizePackageConsumptionDecision } from '../../shared/sessionScheduling.js';
import { createEmptyGooglePhotosAlbum } from './googlePhotosClient.js';

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
    providerAlbumId: sanitizeText(card.providerAlbumId, 512),
    createdViaApi: card.createdViaApi === true,
    creationOperationId: sanitizeText(card.creationOperationId, 128),
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
    name: sanitizeText(data.name || data.fullName, 160) || 'Atendente',
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

function resolvePackageForSave(sessions, payments, patient, packageNumber) {
  const patientId = String(patient?.id || '');
  const model = buildActivityMediaPackageModel(sessions, {
    patientId,
    payments,
    packageTolerances: patient?.data?.packageTolerances || [],
  });
  const targetPackageNumber = normalizeGooglePhotosPackageNumber(packageNumber);
  if (!targetPackageNumber) {
    throw albumError('google-photos-albums/invalid-package', 'Informe um pacote válido para salvar os links.');
  }
  const authorizedPackageNumber = Number(model.visiblePackageLimit || model.activatedPackageNumber || model.currentPackageNumber || 0);
  if (authorizedPackageNumber && targetPackageNumber > authorizedPackageNumber) {
    throw albumError(
      'google-photos-albums/package-not-activated',
      'Este pacote ainda não foi liberado pelo pagamento e não pode receber links.',
      409,
    );
  }
  const targetPackage = model.packages.find(pkg => pkg.number === targetPackageNumber);
  if (!targetPackage) {
    throw albumError(
      'google-photos-albums/package-not-started',
      'O pacote informado ainda não possui sessões disponíveis para registro.',
      409,
    );
  }
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
    providerAlbumId: sanitizeText(existing?.providerAlbumId, 512),
    createdViaApi: existing?.createdViaApi === true,
    creationOperationId: sanitizeText(existing?.creationOperationId, 128),
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

  if (normalizedScope === 'portal' && !['responsible', 'admin', 'monitoring'].includes(effectiveRole(context))) {
    throw albumError('google-photos-albums/portal-scope-denied', 'Este modo de visualização não está disponível para o seu perfil.', 403);
  }

  let activatedPackageNumber = null;
  let paymentQueryCount = 0;
  if (normalizedScope === 'portal') {
    const [payments, patient] = await Promise.all([
      listPatientPayments(context, normalizedPatientId),
      getPatient(context, normalizedPatientId),
    ]);
    const paidActivatedPackageNumber = getActivatedPackageNumber(payments, { patientId: normalizedPatientId });
    const tolerancePackageNumber = getHighestRecordedTolerancePackageNumber(patient?.data?.packageTolerances || []);
    activatedPackageNumber = Math.max(paidActivatedPackageNumber, tolerancePackageNumber);
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
  const packageContext = resolvePackageForSave(sessions, payments, patient, packageNumber);
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


function creationOperationCollection(context) {
  return getAdminDb().collection(`users/${context.ownerUserId}/${GOOGLE_PHOTOS_ALBUM_CREATION_COLLECTION}`);
}

export function buildGooglePhotosProviderAlbumTitle(patientName = '', activityDate = '') {
  const firstName = sanitizeText(patientName, 80).split(/\s+/u).filter(Boolean)[0] || 'Atendente';
  const normalizedDate = sanitizeText(activityDate, 10);
  if (!isSafeGooglePhotosAlbumDate(normalizedDate)) return firstName;
  const [year, month, day] = normalizedDate.split('-');
  return `${firstName} - ${day}/${month}/${year}`;
}

export function buildGooglePhotosAlbumCreationOperationId({ patientId, packageNumber, sessionGroupKey } = {}) {
  const normalizedPatientId = sanitizeText(patientId, 160);
  const normalizedPackageNumber = normalizeGooglePhotosPackageNumber(packageNumber);
  const normalizedGroupKey = sanitizeText(sessionGroupKey, 700);
  if (!normalizedPatientId || !normalizedPackageNumber || !normalizedGroupKey) return '';
  return crypto
    .createHash('sha256')
    .update(`${normalizedPatientId}\n${normalizedPackageNumber}\n${normalizedGroupKey}`, 'utf8')
    .digest('hex');
}

function normalizeAlbumCreationInput({ context, input, patient, packageKey, packageNumber, packageContext }) {
  const sessionIds = normalizeGooglePhotosSessionIds(input?.sessionIds);
  if (sessionIds.length === 0) {
    throw albumError(
      'google-photos-albums/missing-session-binding',
      'Selecione ao menos uma sessão válida antes de criar o álbum.',
    );
  }

  const selectedSessions = sessionIds.map(sessionId => packageContext.selectableById.get(sessionId));
  if (selectedSessions.some(session => !session)) {
    throw albumError(
      'google-photos-albums/invalid-session-binding',
      'O álbum só pode ser criado para sessões realizadas ou em andamento do pacote atual.',
      409,
    );
  }

  const dates = [...new Set(selectedSessions.map(session => sanitizeText(session.date, 10)))];
  if (dates.length !== 1 || !isSafeGooglePhotosAlbumDate(dates[0])) {
    throw albumError(
      'google-photos-albums/invalid-session-binding',
      'Sessões agrupadas no mesmo álbum precisam pertencer à mesma data.',
      409,
    );
  }

  const activityDate = dates[0];
  if (sanitizeText(input?.activityDate, 10) && sanitizeText(input.activityDate, 10) !== activityDate) {
    throw albumError(
      'google-photos-albums/session-date-mismatch',
      'A data enviada não corresponde às sessões selecionadas.',
      409,
    );
  }

  const sessionGroupKey = buildGooglePhotosAlbumGroupKey({
    patientId: patient.id,
    activityDate,
    sessionIds,
  });
  if (!sessionGroupKey) {
    throw albumError('google-photos-albums/invalid-group', 'Não foi possível relacionar o álbum à atividade.');
  }
  const requestedGroupKey = sanitizeText(input?.sessionGroupKey, 700);
  if (requestedGroupKey && requestedGroupKey !== sessionGroupKey) {
    throw albumError(
      'google-photos-albums/session-group-mismatch',
      'O contexto do card foi alterado. Atualize a galeria e tente novamente.',
      409,
    );
  }

  const title = sanitizeText(input?.title, MAX_TITLE_LENGTH);
  if (!title) throw albumError('google-photos-albums/missing-title', 'Informe o título da publicação.');
  const providerAlbumTitle = sanitizeText(
    buildGooglePhotosProviderAlbumTitle(patient.name, activityDate),
    MAX_TITLE_LENGTH,
  );

  const publishedAt = sanitizeText(input?.publishedAt || activityDate, 10);
  if (!isSafeGooglePhotosAlbumDate(publishedAt)) {
    throw albumError('google-photos-albums/invalid-published-date', 'Informe uma data de publicação válida.');
  }

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
    providerAlbumTitle,
    category: normalizeGooglePhotosCategory(input?.category),
    observation: sanitizeText(input?.observation, MAX_OBSERVATION_LENGTH),
    publishedAt,
    recreateDeletedAlbum: input?.recreateDeletedAlbum === true,
    requestedByUserId: context.userId,
    requestedByName: context.actorName,
  };
}

function existingCardFromPackageSnapshot(snapshot, sessionGroupKey, fallback) {
  const rawCard = snapshot?.exists ? snapshot.data()?.cards?.[sessionGroupKey] : null;
  if (!rawCard) return null;
  const card = serializeAlbumCard(rawCard, fallback);
  return card.url ? card : null;
}

function creationInProgressError(status) {
  if (status === 'unknown') {
    return albumError(
      'google-photos-albums/creation-outcome-unknown',
      'O Google não confirmou o resultado da tentativa anterior. Para evitar álbum duplicado, uma nova criação foi bloqueada e precisa de conferência manual.',
      409,
    );
  }
  return albumError(
    'google-photos-albums/creation-in-progress',
    'Este álbum já está sendo criado. Aguarde a conclusão antes de tentar novamente.',
    409,
  );
}

function buildCreatedAlbumCard(context, normalized, operationId, externalAlbum, now) {
  const cardInput = { ...normalized };
  delete cardInput.providerAlbumTitle;
  return {
    ...cardInput,
    url: externalAlbum.productUrl,
    visibleToGuardian: true,
    status: 'active',
    createdByUserId: context.userId,
    createdByName: context.actorName,
    createdAt: now,
    updatedByUserId: context.userId,
    updatedByName: context.actorName,
    updatedAt: now,
    hiddenAt: null,
    reactivatedAt: null,
    providerAlbumId: externalAlbum.id,
    createdViaApi: true,
    creationOperationId: operationId,
  };
}

function creationResponse({
  context,
  permissions,
  packageSnapshot,
  patient,
  packageNumber,
  createdAlbum,
  idempotent,
  recreationAvailable = false,
  recreated = false,
}) {
  const saved = serializePackage(packageSnapshot, {
    patientId: patient.id,
    patientName: patient.name,
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
    packageKey: saved.packageKey,
    packageNumber,
    permissions,
    queryCount: 6,
    readUpperBound: MAX_SESSIONS_PER_PATIENT + MAX_PAYMENTS_PER_PATIENT + 5,
    scope: 'manage',
    createdAlbum: {
      id: sanitizeText(createdAlbum?.id, 512),
      productUrl: normalizeGooglePhotosAlbumUrl(createdAlbum?.productUrl) || '',
      title: sanitizeText(createdAlbum?.title, MAX_TITLE_LENGTH),
      idempotent: idempotent === true,
      recreationAvailable: recreationAvailable === true,
      recreated: recreated === true,
    },
  };
}

export async function createGooglePhotosAlbumForPackage(
  context,
  input,
  { createAlbum = createEmptyGooglePhotosAlbum } = {},
) {
  const permissions = assertCapability(context, 'canCreate');
  const patient = await getPatient(context, input?.patientId);
  const packageNumber = normalizeGooglePhotosPackageNumber(input?.packageNumber);
  const ref = packageRef(context, patient.id, packageNumber);
  const [sessions, payments] = await Promise.all([
    listPatientSessions(context, patient.id),
    listPatientPayments(context, patient.id),
  ]);
  const packageContext = resolvePackageForSave(sessions, payments, patient, packageNumber);
  const normalized = normalizeAlbumCreationInput({
    context,
    input,
    patient,
    packageKey: ref.id,
    packageNumber,
    packageContext,
  });
  const operationId = buildGooglePhotosAlbumCreationOperationId({
    patientId: patient.id,
    packageNumber,
    sessionGroupKey: normalized.sessionGroupKey,
  });
  const operationRef = creationOperationCollection(context).doc(operationId);
  const db = getAdminDb();

  const reservation = await db.runTransaction(async transaction => {
    const operationSnapshot = await transaction.get(operationRef);
    const packageSnapshot = await transaction.get(ref);
    const existingCard = existingCardFromPackageSnapshot(packageSnapshot, normalized.sessionGroupKey, {
      patientId: patient.id,
      patientName: patient.name,
      packageKey: ref.id,
      packageNumber,
    });
    if (existingCard) {
      return {
        kind: 'existing',
        createdAlbum: {
          id: existingCard.providerAlbumId || '',
          productUrl: existingCard.url,
          title: normalized.providerAlbumTitle,
        },
      };
    }

    let recreateFromCompletedOperation = null;
    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data() || {};
      if (operation.status === 'completed' && normalizeGooglePhotosAlbumUrl(operation.productUrl)) {
        if (!normalized.recreateDeletedAlbum) {
          return {
            kind: 'completed',
            recreationAvailable: true,
            createdAlbum: {
              id: sanitizeText(operation.providerAlbumId, 512),
              productUrl: normalizeGooglePhotosAlbumUrl(operation.productUrl),
              title: sanitizeText(operation.providerAlbumTitle || operation.title, MAX_TITLE_LENGTH),
            },
          };
        }
        recreateFromCompletedOperation = operation;
      }
      if (operation.status === 'creating' || operation.status === 'unknown') {
        return { kind: 'blocked', status: operation.status };
      }
      if (operation.status === 'failed' && operation.retryable !== true) {
        return { kind: 'blocked', status: 'unknown' };
      }
    }

    const now = Timestamp.now();
    transaction.set(operationRef, {
      id: operationId,
      schemaVersion: 1,
      provider: GOOGLE_PHOTOS_PROVIDER,
      packageKey: ref.id,
      packageNumber,
      patientId: patient.id,
      patientName: patient.name,
      sessionGroupKey: normalized.sessionGroupKey,
      sessionIds: normalized.sessionIds,
      activityDate: normalized.activityDate,
      title: normalized.providerAlbumTitle,
      cardTitle: normalized.title,
      providerAlbumTitle: normalized.providerAlbumTitle,
      status: 'creating',
      retryable: false,
      attemptCount: Number(operationSnapshot.data()?.attemptCount || 0) + 1,
      requestedByUserId: context.userId,
      requestedByName: context.actorName,
      createdAt: operationSnapshot.exists ? operationSnapshot.data()?.createdAt || now : now,
      updatedAt: now,
      providerAlbumId: FieldValue.delete(),
      productUrl: FieldValue.delete(),
      failureCode: FieldValue.delete(),
      ...(recreateFromCompletedOperation ? {
        recreationCount: Number(recreateFromCompletedOperation.recreationCount || 0) + 1,
        recreatedByUserId: context.userId,
        recreatedByName: context.actorName,
        recreatedAt: now,
        previousProviderAlbumId: sanitizeText(recreateFromCompletedOperation.providerAlbumId, 512),
        previousProductUrl: normalizeGooglePhotosAlbumUrl(recreateFromCompletedOperation.productUrl) || '',
        previousCompletedAt: recreateFromCompletedOperation.completedAt || null,
      } : {}),
    }, { merge: true });
    return { kind: 'claimed', recreated: Boolean(recreateFromCompletedOperation) };
  });

  if (reservation.kind === 'blocked') throw creationInProgressError(reservation.status);
  if (reservation.kind === 'existing' || reservation.kind === 'completed') {
    const packageSnapshot = await ref.get();
    return creationResponse({
      context,
      permissions,
      packageSnapshot,
      patient,
      packageNumber,
      createdAlbum: reservation.createdAlbum,
      idempotent: true,
      recreationAvailable: reservation.recreationAvailable === true,
    });
  }

  let externalAlbum;
  try {
    externalAlbum = await createAlbum({ title: normalized.providerAlbumTitle });
  } catch (error) {
    const outcomeUnknown = error?.creationOutcome === 'unknown';
    try {
      await operationRef.set({
        status: outcomeUnknown ? 'unknown' : 'failed',
        retryable: !outcomeUnknown,
        failureCode: sanitizeText(error?.code || 'google-photos-albums/google-create-failed', 160),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (persistenceError) {
      console.error('[GOOGLE PHOTOS ALBUMS] Falha ao registrar resultado da criação:', persistenceError?.message || persistenceError);
    }
    throw error;
  }

  try {
    await db.runTransaction(async transaction => {
      const operationSnapshot = await transaction.get(operationRef);
      const packageSnapshot = await transaction.get(ref);
      const existingCard = existingCardFromPackageSnapshot(packageSnapshot, normalized.sessionGroupKey, {
        patientId: patient.id,
        patientName: patient.name,
        packageKey: ref.id,
        packageNumber,
      });
      if (existingCard) {
        transaction.set(operationRef, {
          status: 'completed',
          retryable: false,
          providerAlbumId: existingCard.providerAlbumId || externalAlbum.id,
          productUrl: existingCard.url,
          title: normalized.providerAlbumTitle,
          cardTitle: existingCard.title,
          providerAlbumTitle: normalized.providerAlbumTitle,
          updatedAt: Timestamp.now(),
          completedAt: operationSnapshot.data()?.completedAt || Timestamp.now(),
        }, { merge: true });
        return;
      }

      const operation = operationSnapshot.exists ? operationSnapshot.data() || {} : {};
      if (operation.status === 'unknown') throw creationInProgressError('unknown');
      const now = Timestamp.now();
      const createdCard = buildCreatedAlbumCard(context, normalized, operationId, externalAlbum, now);
      const currentPackage = packageSnapshot.exists ? packageSnapshot.data() || {} : {};
      const cards = currentPackage.cards && typeof currentPackage.cards === 'object'
        ? { ...currentPackage.cards, [normalized.sessionGroupKey]: createdCard }
        : { [normalized.sessionGroupKey]: createdCard };
      const packageSessions = packageContext.targetPackage.sessions || [];

      transaction.set(ref, {
        id: ref.id,
        schemaVersion: GOOGLE_PHOTOS_ALBUM_PACKAGE_SCHEMA_VERSION,
        provider: GOOGLE_PHOTOS_PROVIDER,
        packageKey: ref.id,
        patientId: patient.id,
        patientName: patient.name,
        packageNumber,
        packageStartDate: packageContext.targetPackage.startDate || packageSessions[0]?.date || '',
        packageEndDate: packageContext.targetPackage.endDate || packageSessions.at(-1)?.date || '',
        cards,
        createdAt: packageSnapshot.exists ? currentPackage.createdAt || now : now,
        updatedAt: now,
        updatedByUserId: context.userId,
        updatedByName: context.actorName,
      });
      transaction.set(operationRef, {
        status: 'completed',
        retryable: false,
        providerAlbumId: externalAlbum.id,
        productUrl: externalAlbum.productUrl,
        title: externalAlbum.title,
        cardTitle: normalized.title,
        providerAlbumTitle: externalAlbum.title,
        updatedAt: now,
        completedAt: now,
        failureCode: FieldValue.delete(),
      }, { merge: true });
    });
  } catch (error) {
    try {
      await operationRef.set({
        status: 'unknown',
        retryable: false,
        providerAlbumId: sanitizeText(externalAlbum?.id, 512),
        productUrl: normalizeGooglePhotosAlbumUrl(externalAlbum?.productUrl) || '',
        title: normalized.title,
        failureCode: 'google-photos-albums/persistence-unknown',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (persistenceError) {
      console.error('[GOOGLE PHOTOS ALBUMS] Falha ao preservar resultado externo:', persistenceError?.message || persistenceError);
    }
    throw albumError(
      'google-photos-albums/persistence-unknown',
      'O álbum pode ter sido criado, mas o sistema não confirmou o registro. Para evitar duplicidade, uma nova criação foi bloqueada.',
      503,
    );
  }

  const packageSnapshot = await ref.get();
  return creationResponse({
    context,
    permissions,
    packageSnapshot,
    patient,
    packageNumber,
    createdAlbum: externalAlbum,
    idempotent: false,
    recreated: reservation.recreated === true,
  });
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
        name: sanitizeText(data.name || data.fullName, 160) || 'Atendente',
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
    sessions: sessions.map(session => {
      const consumptionDecision = normalizePackageConsumptionDecision(session.consumesPackage);
      return {
        id: session.id,
        patientId: normalizedPatientId,
        date: sanitizeText(session.date, 10),
        time: normalizeTime(session.time),
        type: sanitizeText(session.type, 80),
        status: sanitizeText(session.status, 40),
        packageNumber: Number.isFinite(Number(session.packageNumber)) ? Number(session.packageNumber) : null,
        isBlocked: false,
        ...(consumptionDecision === null ? {} : { consumesPackage: consumptionDecision }),
        packageConsumptionDecisionRecorded: consumptionDecision !== null,
        source: sanitizeText(session.source, 40),
      };
    }),
    queryCount: 1,
    readUpperBound: MAX_SESSIONS_PER_PATIENT,
  };
}
