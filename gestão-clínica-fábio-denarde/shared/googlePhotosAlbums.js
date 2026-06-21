import {
  DEFAULT_ACTIVITY_RECORD_CATEGORY,
  INTERVENTION_ACTIVITY_RECORD_CATEGORY,
} from './activityRecordUi.js';
import { buildActivityMediaPackageModel } from './activityMediaPackages.js';

export const GOOGLE_PHOTOS_PROVIDER = 'google_photos';
export const GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION = 'googlePhotosAlbumPackages';
export const GOOGLE_PHOTOS_ALBUM_CREATION_COLLECTION = 'googlePhotosAlbumCreationOperations';
export const GOOGLE_PHOTOS_ALBUM_PACKAGE_SCHEMA_VERSION = 2;
export const GOOGLE_PHOTOS_ALBUM_STATUSES = Object.freeze(['active', 'hidden', 'removed']);
export const GOOGLE_PHOTOS_ALLOWED_HOSTNAMES = Object.freeze([
  'photos.app.goo.gl',
  'photos.google.com',
]);

export const GOOGLE_PHOTOS_ALBUM_CATEGORIES = Object.freeze([
  DEFAULT_ACTIVITY_RECORD_CATEGORY,
  INTERVENTION_ACTIVITY_RECORD_CATEGORY,
  'Atenção',
  'Memória',
  'Linguagem',
  'Raciocínio lógico',
  'Coordenação motora',
  'Coordenação visuomotora',
  'Funções executivas',
  'Atividade lúdica',
  'Evolução',
  'Devolutiva',
  'Outro',
]);

const ALLOWED_HOSTNAME_SET = new Set(GOOGLE_PHOTOS_ALLOWED_HOSTNAMES);
const ALLOWED_CATEGORY_SET = new Set(GOOGLE_PHOTOS_ALBUM_CATEGORIES);
const SAFE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_TIME_PATTERN = /^\d{2}:\d{2}$/;
const MAX_SESSION_IDS_PER_CARD = 8;

function sanitizeText(value, maxLength = 240) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeDate(value) {
  const date = String(value || '').trim();
  return SAFE_DATE_PATTERN.test(date) ? date : '';
}

function normalizeTime(value) {
  const time = String(value || '').trim();
  return SAFE_TIME_PATTERN.test(time) ? time : '';
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeSessionSortKey(session) {
  const date = normalizeDate(session?.date);
  const time = normalizeTime(session?.time) || '00:00';
  return `${date}T${time}|${String(session?.id || '')}`;
}

function todayIsoDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function formatSessionNumbers(numbers) {
  const values = [...new Set((Array.isArray(numbers) ? numbers : [])
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b);
  if (values.length === 0) return '';
  if (values.length === 1) return `Sessão ${values[0]}`;
  return `Sessões ${values.slice(0, -1).join(', ')} e ${values.at(-1)}`;
}

export function normalizeGooglePhotosAlbumUrl(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 2048 || /[<>]/.test(candidate)) return null;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTNAME_SET.has(parsed.hostname.toLowerCase())) return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  if (!parsed.pathname || parsed.pathname === '/') return null;

  return parsed.toString();
}

export function isValidGooglePhotosAlbumUrl(value) {
  return normalizeGooglePhotosAlbumUrl(value) !== null;
}

export function normalizeGooglePhotosCategory(value) {
  const category = String(value || '').trim();
  return ALLOWED_CATEGORY_SET.has(category)
    ? category
    : DEFAULT_ACTIVITY_RECORD_CATEGORY;
}

export function normalizeGooglePhotosAlbumStatus(value) {
  const status = String(value || '').trim();
  return GOOGLE_PHOTOS_ALBUM_STATUSES.includes(status) ? status : 'active';
}

export function normalizeGooglePhotosPackageNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 999) return 0;
  return number;
}

export function normalizeGooglePhotosSessionIds(value, maxItems = MAX_SESSION_IDS_PER_CARD) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => String(item || '').trim())
    .filter(Boolean))]
    .sort()
    .slice(0, maxItems);
}

export function buildGooglePhotosAlbumPackageKey({ patientId, packageNumber } = {}) {
  const normalizedPatientId = String(patientId || '').trim();
  const normalizedPackageNumber = normalizeGooglePhotosPackageNumber(packageNumber);
  if (!normalizedPatientId || !normalizedPackageNumber) return '';
  return `${normalizedPatientId.replace(/[^A-Za-z0-9_-]/g, '_')}__package_${normalizedPackageNumber}`;
}

export function buildGooglePhotosAlbumGroupKey({ patientId, activityDate, sessionIds = [] } = {}) {
  const normalizedPatientId = String(patientId || '').trim();
  const normalizedDate = String(activityDate || '').trim();
  if (!normalizedPatientId || !SAFE_DATE_PATTERN.test(normalizedDate)) return '';
  const normalizedSessionIds = normalizeGooglePhotosSessionIds(sessionIds);
  return normalizedSessionIds.length > 0
    ? `sessions:${normalizedPatientId}:${normalizedDate}:${normalizedSessionIds.join(',')}`
    : `date:${normalizedPatientId}:${normalizedDate}`;
}

export function getGooglePhotosAlbumCapabilities({ role, activeContext, scope = 'manage' } = {}) {
  const effectiveRole = activeContext === 'monitoring' ? 'monitoring' : role;
  const portalScope = scope === 'portal';
  return Object.freeze({
    canView: portalScope
      ? effectiveRole === 'responsible' || effectiveRole === 'admin'
      : ['admin', 'professional', 'monitoring'].includes(effectiveRole),
    canCreate: !portalScope && ['admin', 'professional'].includes(effectiveRole),
    canEdit: !portalScope && ['admin', 'professional'].includes(effectiveRole),
    canHide: !portalScope && effectiveRole === 'admin',
    canReactivate: !portalScope && effectiveRole === 'admin',
    canRemove: !portalScope && effectiveRole === 'admin',
  });
}

export function isGooglePhotosAlbumPatientAllowed(allowedPatientIds, patientId, role) {
  if (role === 'admin') return Boolean(String(patientId || '').trim());
  const normalizedPatientId = String(patientId || '').trim();
  return Array.isArray(allowedPatientIds) && allowedPatientIds.includes(normalizedPatientId);
}

export function isGooglePhotosAlbumVisibleToPortal(album, patientId, packageNumber = 0) {
  const normalizedPackageNumber = normalizeGooglePhotosPackageNumber(packageNumber);
  return Boolean(
    album
    && String(album.patientId || '') === String(patientId || '')
    && (!normalizedPackageNumber || Number(album.packageNumber || 0) === normalizedPackageNumber)
    && album.provider === GOOGLE_PHOTOS_PROVIDER
    && album.status === 'active'
    && album.visibleToGuardian === true
    && normalizeGooglePhotosAlbumUrl(album.url),
  );
}

export function filterGooglePhotosAlbumsForViewer(albums, {
  patientId,
  packageNumber = 0,
  role,
  activeContext,
  scope = 'manage',
  monitoringStartDate = '',
} = {}) {
  const effectiveRole = activeContext === 'monitoring' ? 'monitoring' : role;
  const normalizedPackageNumber = normalizeGooglePhotosPackageNumber(packageNumber);
  const source = Array.isArray(albums) ? albums : [];

  return source.filter(album => {
    if (!album || String(album.patientId || '') !== String(patientId || '')) return false;
    if (normalizedPackageNumber && Number(album.packageNumber || 0) !== normalizedPackageNumber) return false;
    if (album.provider !== GOOGLE_PHOTOS_PROVIDER || album.status === 'removed') return false;
    if (!normalizeGooglePhotosAlbumUrl(album.url)) return false;
    if (scope === 'portal') return isGooglePhotosAlbumVisibleToPortal(album, patientId, normalizedPackageNumber);
    if (effectiveRole === 'monitoring') {
      return album.status === 'active'
        && album.visibleToGuardian === true
        && SAFE_DATE_PATTERN.test(String(monitoringStartDate || ''))
        && String(album.activityDate || '') >= monitoringStartDate;
    }
    return effectiveRole === 'admin' || effectiveRole === 'professional';
  });
}

export function isSafeGooglePhotosAlbumDate(value) {
  const date = String(value || '').trim();
  if (!SAFE_DATE_PATTERN.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function buildGooglePhotosSessionActivityKey(session) {
  const date = normalizeDate(session?.date);
  const explicitGroup = [
    session?.googlePhotosActivityGroupKey,
    session?.activityAlbumGroupKey,
    session?.activityGroupKey,
    session?.mediaGroupKey,
  ].map(value => sanitizeText(value, 160)).find(Boolean);

  if (date && explicitGroup) return `explicit:${date}:${explicitGroup}`;
  return `session:${String(session?.id || '')}`;
}


function timeToMinutes(value) {
  const time = normalizeTime(value);
  if (!time) return null;
  const [hour, minute] = time.split(':').map(Number);
  return (hour * 60) + minute;
}

function isDoubleSession(session) {
  const type = String(session?.type || '').toLocaleLowerCase('pt-BR');
  return session?.doubleSession === true || type.includes('sessão dupla') || type.includes('sessao dupla');
}

function normalizeActivitySessionNumber(session) {
  const number = Number(
    session?.activitySessionNumber
    ?? session?.sessionNumber
    ?? session?.packageSessionNumber,
  );
  return Number.isInteger(number) && number > 0 && number <= 10 ? number : 0;
}

function isHistoricalDoubleSessionPair(session, candidate) {
  const sessionNumber = normalizeActivitySessionNumber(session);
  const candidateNumber = normalizeActivitySessionNumber(candidate);
  if (!sessionNumber || !candidateNumber) return false;

  const expectedPairStart = Math.floor((sessionNumber - 1) / 2) * 2 + 1;
  const pairNumbers = new Set([expectedPairStart, expectedPairStart + 1]);
  if (!pairNumbers.has(candidateNumber) || sessionNumber === candidateNumber) return false;

  if (String(candidate?.date || '') !== String(session?.date || '')) return false;

  const sessionPackage = Number(session?.activityPackageNumber || 0);
  const candidatePackage = Number(candidate?.activityPackageNumber || 0);
  if (sessionPackage && candidatePackage && sessionPackage !== candidatePackage) return false;

  const baseMinutes = timeToMinutes(session?.time);
  const candidateMinutes = timeToMinutes(candidate?.time);
  return baseMinutes !== null
    && candidateMinutes !== null
    && Math.abs(candidateMinutes - baseMinutes) === 60;
}

export function groupGooglePhotosActivitySessions(rawSessions, { patientDoubleSession = false } = {}) {
  const sessions = (Array.isArray(rawSessions) ? rawSessions : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => normalizeSessionSortKey(a).localeCompare(normalizeSessionSortKey(b)));
  const explicitGroups = new Map();
  const automaticCandidates = [];

  for (const session of sessions) {
    const key = buildGooglePhotosSessionActivityKey(session);
    if (key.startsWith('explicit:')) {
      const group = explicitGroups.get(key) || [];
      group.push(session);
      explicitGroups.set(key, group);
    } else {
      automaticCandidates.push(session);
    }
  }

  const groups = [...explicitGroups.values()];
  const used = new Set();

  for (let index = 0; index < automaticCandidates.length; index += 1) {
    const session = automaticCandidates[index];
    const sessionId = String(session?.id || '');
    if (!sessionId || used.has(sessionId)) continue;

    const group = [session];
    used.add(sessionId);

    const baseMinutes = timeToMinutes(session.time);
    const pair = automaticCandidates.find(candidate => {
      const candidateId = String(candidate?.id || '');
      if (!candidateId || used.has(candidateId)) return false;

      if (patientDoubleSession && isHistoricalDoubleSessionPair(session, candidate)) return true;
      if (!isDoubleSession(session) || !isDoubleSession(candidate)) return false;
      if (String(candidate.date || '') !== String(session.date || '')) return false;

      const candidateMinutes = timeToMinutes(candidate.time);
      return baseMinutes !== null
        && candidateMinutes !== null
        && Math.abs(candidateMinutes - baseMinutes) === 60;
    });

    if (pair) {
      group.push(pair);
      used.add(String(pair.id));
    }

    groups.push(group);
  }

  return groups;
}

export function createEmptyGooglePhotosAlbumCard({
  patientId,
  patientName = '',
  packageNumber,
  packageKey,
  activityDate,
  sessionIds = [],
  sessionTime = '',
  sessionNumbers = [],
  title = '',
  category = INTERVENTION_ACTIVITY_RECORD_CATEGORY,
} = {}) {
  const normalizedSessionIds = normalizeGooglePhotosSessionIds(sessionIds);
  const normalizedActivityDate = normalizeDate(activityDate);
  const normalizedPackageNumber = normalizeGooglePhotosPackageNumber(packageNumber);
  const resolvedPackageKey = packageKey || buildGooglePhotosAlbumPackageKey({ patientId, packageNumber: normalizedPackageNumber });
  const sessionGroupKey = buildGooglePhotosAlbumGroupKey({
    patientId,
    activityDate: normalizedActivityDate,
    sessionIds: normalizedSessionIds,
  });
  return {
    id: sessionGroupKey,
    schemaVersion: GOOGLE_PHOTOS_ALBUM_PACKAGE_SCHEMA_VERSION,
    provider: GOOGLE_PHOTOS_PROVIDER,
    packageKey: resolvedPackageKey,
    packageNumber: normalizedPackageNumber,
    patientId: sanitizeText(patientId, 160),
    patientName: sanitizeText(patientName, 160),
    source: normalizedSessionIds.length > 0 ? 'session' : 'date',
    sessionId: normalizedSessionIds[0] || null,
    sessionIds: normalizedSessionIds,
    sessionGroupKey,
    activityDate: normalizedActivityDate,
    sessionTime: normalizeTime(sessionTime) || null,
    sessionNumbers: [...new Set((Array.isArray(sessionNumbers) ? sessionNumbers : [])
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0))]
      .sort((a, b) => a - b),
    title: sanitizeText(title, 120) || INTERVENTION_ACTIVITY_RECORD_CATEGORY,
    category: normalizeGooglePhotosCategory(category),
    url: '',
    visibleToGuardian: false,
    observation: '',
    publishedAt: normalizedActivityDate,
    status: 'active',
    createdByUserId: '',
    createdByName: '',
    createdAt: null,
    updatedByUserId: '',
    updatedByName: '',
    updatedAt: null,
    hiddenAt: null,
    reactivatedAt: null,
    isVirtual: true,
  };
}

export function buildGooglePhotosVirtualAlbumCards(rawSessions, {
  patientId = '',
  patientName = '',
  patientDoubleSession = false,
  packageNumber = 0,
  now = new Date(),
  payments = null,
} = {}) {
  const model = buildActivityMediaPackageModel(rawSessions, { patientId, now, payments });
  const requestedPackageNumber = normalizeGooglePhotosPackageNumber(packageNumber) || model.currentPackageNumber;
  const targetPackage = model.packages.find(pkg => pkg.number === requestedPackageNumber)
    || model.packages.find(pkg => pkg.number === model.currentPackageNumber)
    || null;
  if (!targetPackage) return [];

  const packageKey = buildGooglePhotosAlbumPackageKey({
    patientId,
    packageNumber: targetPackage.number,
  });
  const groupedSessions = groupGooglePhotosActivitySessions(
    (targetPackage.sessions || []).filter(session => session?.selectableForMedia),
    { patientDoubleSession: normalizeBoolean(patientDoubleSession) },
  );

  return groupedSessions
    .map(groupSessions => {
      const sorted = groupSessions.slice().sort((a, b) => normalizeSessionSortKey(a).localeCompare(normalizeSessionSortKey(b)));
      const activityDate = normalizeDate(sorted[0]?.date);
      const sessionIds = sorted.map(session => String(session.id || '')).filter(Boolean);
      const sessionNumbers = sorted
        .map(session => Number(session.activitySessionNumber ?? session.packageNumber))
        .filter(value => Number.isFinite(value) && value > 0);
      const numberLabel = formatSessionNumbers(sessionNumbers);
      const doubleSessionGroup = sorted.length === 2;
      return createEmptyGooglePhotosAlbumCard({
        patientId,
        patientName,
        packageNumber: targetPackage.number,
        packageKey,
        activityDate,
        sessionIds,
        sessionTime: sorted[0]?.time || '',
        sessionNumbers,
        title: doubleSessionGroup
          ? `${INTERVENTION_ACTIVITY_RECORD_CATEGORY} - Sessão dupla`
          : numberLabel ? `${INTERVENTION_ACTIVITY_RECORD_CATEGORY} - ${numberLabel}` : INTERVENTION_ACTIVITY_RECORD_CATEGORY,
        category: INTERVENTION_ACTIVITY_RECORD_CATEGORY,
      });
    })
    .filter(card => card.sessionGroupKey)
    .sort((left, right) => (
      `${right.activityDate}T${right.sessionTime || '00:00'}|${right.sessionGroupKey}`
        .localeCompare(`${left.activityDate}T${left.sessionTime || '00:00'}|${left.sessionGroupKey}`)
    ));
}


export function buildGooglePhotosAlbumEditorSignature(album = {}) {
  return JSON.stringify({
    id: String(album?.id || album?.sessionGroupKey || ''),
    packageKey: String(album?.packageKey || ''),
    packageNumber: Number(album?.packageNumber || 0),
    patientId: String(album?.patientId || ''),
    sessionIds: normalizeGooglePhotosSessionIds(album?.sessionIds).sort(),
    sessionGroupKey: String(album?.sessionGroupKey || ''),
    activityDate: String(album?.activityDate || ''),
    title: String(album?.title || ''),
    category: String(album?.category || ''),
    url: String(album?.url || ''),
    visibleToGuardian: normalizeBoolean(album?.visibleToGuardian),
    observation: String(album?.observation || ''),
    publishedAt: String(album?.publishedAt || ''),
    status: normalizeGooglePhotosAlbumStatus(album?.status),
  });
}

export function hasGooglePhotosAlbumEditorChanges(current = {}, baseline = {}) {
  return buildGooglePhotosAlbumEditorSignature(current) !== buildGooglePhotosAlbumEditorSignature(baseline);
}

export function getGooglePhotosAlbumDisplayTitle(album = {}) {
  const category = sanitizeText(album?.category, 120) || INTERVENTION_ACTIVITY_RECORD_CATEGORY;
  const title = sanitizeText(album?.title, 120) || category;
  const sessionIds = normalizeGooglePhotosSessionIds(album?.sessionIds);
  if (sessionIds.length < 2) return title;

  const generatedPrefixes = [
    category,
    DEFAULT_ACTIVITY_RECORD_CATEGORY,
    INTERVENTION_ACTIVITY_RECORD_CATEGORY,
    'Atividade Pedagógica',
  ].filter(Boolean);
  const isGeneratedSessionTitle = generatedPrefixes.some(prefix => (
    title === prefix
    || title.toLocaleLowerCase('pt-BR').startsWith(`${String(prefix).toLocaleLowerCase('pt-BR')} - sessão`)
  ));

  return isGeneratedSessionTitle ? `${category} - Sessão dupla` : title;
}

export function mergeGooglePhotosAlbumCards({
  virtualCards = [],
  persistedCards = [],
  draftCards = [],
  removedCardIds = [],
} = {}) {
  const removed = new Set((Array.isArray(removedCardIds) ? removedCardIds : []).map(value => String(value || '')));
  const result = [];
  const byId = new Set();
  const coveredSessionIds = new Set();

  function addCard(card, source) {
    const id = String(card?.id || card?.sessionGroupKey || '');
    if (!id || removed.has(id) || byId.has(id)) return;
    const sessionIds = normalizeGooglePhotosSessionIds(card.sessionIds);
    if (source === 'virtual' && sessionIds.some(sessionId => coveredSessionIds.has(sessionId))) return;
    const normalized = {
      ...card,
      id,
      sessionIds,
      sessionId: sessionIds[0] || null,
      sessionGroupKey: String(card.sessionGroupKey || id),
      status: normalizeGooglePhotosAlbumStatus(card.status),
      category: normalizeGooglePhotosCategory(card.category),
      title: getGooglePhotosAlbumDisplayTitle({ ...card, sessionIds }),
      url: normalizeGooglePhotosAlbumUrl(card.url) || '',
      visibleToGuardian: normalizeBoolean(card.visibleToGuardian),
      isVirtual: source === 'virtual',
    };
    result.push(normalized);
    byId.add(id);
    for (const sessionId of sessionIds) coveredSessionIds.add(sessionId);
  }

  for (const card of Array.isArray(draftCards) ? draftCards : []) addCard(card, 'draft');
  for (const card of Array.isArray(persistedCards) ? persistedCards : []) addCard(card, 'persisted');
  for (const card of Array.isArray(virtualCards) ? virtualCards : []) addCard(card, 'virtual');

  return result.sort((left, right) => (
    `${right.activityDate}T${right.sessionTime || '00:00'}|${right.sessionGroupKey}`
      .localeCompare(`${left.activityDate}T${left.sessionTime || '00:00'}|${left.sessionGroupKey}`)
  ));
}
