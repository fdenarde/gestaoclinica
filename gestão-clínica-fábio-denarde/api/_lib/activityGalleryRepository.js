import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin.js';
import { assertActivityPatientAccess } from './accessContext.js';
import { activityError, sanitizeText } from './activityRecordsValidation.js';
import {
  getActivitySessionEndAt,
  normalizeActivitySessionIds,
  resolveActivityUploadState,
} from '../../shared/activityGalleryStatus.js';
import { buildActivityMediaPackageModel } from '../../shared/activityMediaPackages.js';

const PRIMARY_ADMIN_EMAIL = 'fdenarde@gmail.com';
const MAX_PATIENTS = 500;
const MAX_MONITORED_SESSIONS = 2000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const JUSTIFICATION_REASONS = new Set([
  'atividade sem registro visual',
  'responsável não autorizou',
  'sessão administrativa',
  'atendimento virtual',
  'mídia não produzida',
  'problema técnico',
  'outro',
]);

function serializeDate(value) {
  if (value?.toDate instanceof Function) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function patientRef(context, patientId) {
  assertActivityPatientAccess(context, patientId);
  return getAdminDb().doc(`users/${context.ownerUserId}/patients/${patientId}`);
}

function sessionRef(context, sessionId) {
  return getAdminDb().doc(`users/${context.ownerUserId}/sessions/${sessionId}`);
}

export function activityUploadStatusRef(context, sessionId) {
  return getAdminDb().doc(`users/${context.ownerUserId}/activityUploadStatus/${sessionId}`);
}

function activityAuditCollection(context) {
  return getAdminDb().collection(`users/${context.ownerUserId}/activityAudit`);
}

function normalizeStatusRecord(snapshot) {
  if (!snapshot?.exists) return null;
  const data = snapshot.data() || {};
  const justification = data.justification && typeof data.justification === 'object'
    ? {
        ...data.justification,
        createdAt: serializeDate(data.justification.createdAt),
        updatedAt: serializeDate(data.justification.updatedAt),
        removedAt: serializeDate(data.justification.removedAt),
      }
    : null;
  return {
    sessionId: snapshot.id,
    patientId: String(data.patientId || ''),
    hasMedia: Boolean(data.hasMedia) || Number(data.mediaCount || 0) > 0,
    mediaCount: Math.max(0, Number(data.mediaCount || 0)),
    lastUploadAt: serializeDate(data.lastUploadAt),
    lastUploadedByUserId: String(data.lastUploadedByUserId || ''),
    lastUploadedByName: String(data.lastUploadedByName || ''),
    lastRecordId: String(data.lastRecordId || ''),
    justification,
    updatedAt: serializeDate(data.updatedAt),
  };
}

async function getSnapshotsInChunks(refs, chunkSize = 400) {
  const db = getAdminDb();
  const snapshots = [];
  for (let index = 0; index < refs.length; index += chunkSize) {
    snapshots.push(...await db.getAll(...refs.slice(index, index + chunkSize)));
  }
  return snapshots;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const source = Array.from(items || []);
  const results = new Array(source.length);
  let nextIndex = 0;
  const workers = Math.max(1, Math.min(concurrency, source.length || 1));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (nextIndex < source.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(source[index], index);
    }
  }));
  return results;
}

async function listAccessiblePatients(context) {
  const db = getAdminDb();
  if (context.role === 'professional') {
    const ids = Array.isArray(context.allowedPatientIds) ? context.allowedPatientIds : [];
    if (ids.length === 0) return [];
    const snapshots = await getSnapshotsInChunks(ids.map(patientId => patientRef(context, patientId)));
    return snapshots.filter(snapshot => snapshot.exists).map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
  }
  const snapshot = await db.collection(`users/${context.ownerUserId}/patients`).limit(MAX_PATIENTS).get();
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

async function listAccessibleActivitySessions(context, patientIds = null) {
  const db = getAdminDb();
  const scopedPatientIds = Array.isArray(patientIds)
    ? patientIds
    : context.role === 'professional'
      ? Array.isArray(context.allowedPatientIds) ? context.allowedPatientIds : []
      : null;
  if (Array.isArray(scopedPatientIds) && scopedPatientIds.length === 0) return [];

  if (context.role === 'professional') {
    const grouped = await mapWithConcurrency(scopedPatientIds, 4, async patientId => {
      const snapshot = await db.collection(`users/${context.ownerUserId}/sessions`)
        .where('patientId', '==', patientId)
        .limit(500)
        .get();
      return snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .filter(session => ['Realizada', 'Reposição', 'Falta', 'Agendada'].includes(session.status) && !session.isBlocked);
    });
    return grouped.flat().slice(0, MAX_MONITORED_SESSIONS);
  }

  const snapshot = await db.collection(`users/${context.ownerUserId}/sessions`)
    .where('status', 'in', ['Realizada', 'Reposição', 'Falta', 'Agendada'])
    .limit(MAX_MONITORED_SESSIONS)
    .get();
  const allowed = Array.isArray(scopedPatientIds) ? new Set(scopedPatientIds) : null;
  return snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(session => (!allowed || allowed.has(String(session.patientId || ''))) && !session.isBlocked);
}


function selectCurrentPackageRealizedSessions(sessions, now = new Date()) {
  const byPatient = new Map();
  for (const session of sessions) {
    const patientId = String(session.patientId || '');
    if (!patientId) continue;
    const current = byPatient.get(patientId) || [];
    current.push(session);
    byPatient.set(patientId, current);
  }

  const selected = [];
  for (const [patientId, patientSessions] of byPatient.entries()) {
    const model = buildActivityMediaPackageModel(patientSessions, { patientId, now });
    selected.push(...model.currentSessions.filter(session => session.status === 'Realizada'));
  }
  return selected;
}

async function getMonitoringStart(context) {
  const snapshot = await getAdminDb().doc(`users/${context.ownerUserId}/settings/config`).get();
  const value = snapshot.exists ? snapshot.data()?.activityMediaMonitoringStart : null;
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function getActivityStatusMap(context, monitoredSessions) {
  if (monitoredSessions.length === 0) return new Map();
  if (context.role === 'professional') {
    const snapshots = await getSnapshotsInChunks(
      monitoredSessions.map(session => activityUploadStatusRef(context, session.id)),
    );
    return new Map(snapshots.map(snapshot => [snapshot.id, normalizeStatusRecord(snapshot)]));
  }

  // Para o administrador, ler a coleção de resumos existentes evita uma leitura
  // cobrada para cada sessão que ainda não possui mídia ou justificativa.
  const monitoredIds = new Set(monitoredSessions.map(session => session.id));
  const snapshot = await getAdminDb()
    .collection(`users/${context.ownerUserId}/activityUploadStatus`)
    .limit(MAX_MONITORED_SESSIONS)
    .get();
  return new Map(snapshot.docs
    .filter(item => monitoredIds.has(item.id))
    .map(item => [item.id, normalizeStatusRecord(item)]));
}

function calculateGalleryMetrics(monitoredSessions, statusBySession, monitoringStart, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
  let nextTransitionAt = null;
  let waitingSessionCount = 0;
  let lateSessionCount = 0;
  let regularizedTodayCount = 0;
  const latePatients = new Set();

  for (const session of monitoredSessions) {
    const statusRecord = statusBySession.get(session.id);
    const resolved = resolveActivityUploadState({ session, monitoringStart, statusRecord, now });
    if (resolved.state === 'waiting') {
      waitingSessionCount += 1;
      if (resolved.deadlineAt && (!nextTransitionAt || resolved.deadlineAt < nextTransitionAt)) nextTransitionAt = resolved.deadlineAt;
    }
    if (resolved.state === 'overdue') {
      lateSessionCount += 1;
      latePatients.add(session.patientId);
      const endAtMillis = resolved.endAt ? new Date(resolved.endAt).getTime() : 0;
      const escalationAt = resolved.escalation < 48
        ? endAtMillis + 48 * 60 * 60_000
        : resolved.escalation < 72
          ? endAtMillis + 72 * 60 * 60_000
          : 0;
      if (escalationAt > now.getTime()) {
        const escalationIso = new Date(escalationAt).toISOString();
        if (!nextTransitionAt || escalationIso < nextTransitionAt) nextTransitionAt = escalationIso;
      }
    }
    const regularizedAt = statusRecord?.lastUploadAt
      || (statusRecord?.justification?.active ? statusRecord.justification.updatedAt || statusRecord.justification.createdAt : null);
    if (regularizedAt) {
      const regularizedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(regularizedAt));
      if (regularizedDate === today && ['sent', 'excused'].includes(resolved.state)) regularizedTodayCount += 1;
    }
  }

  return {
    latePatientCount: latePatients.size,
    waitingSessionCount,
    regularizedTodayCount,
    lateSessionCount,
    nextTransitionAt,
  };
}

async function buildProfessionalAssignments(context, patients) {
  const byPatient = new Map(patients.map(patient => [patient.id, []]));
  if (context.role === 'professional') {
    for (const patientId of context.allowedPatientIds || []) {
      if (byPatient.has(patientId)) byPatient.set(patientId, [context.actorName || 'Profissional']);
    }
    return byPatient;
  }

  const snapshot = await getAdminDb().collection('accessProfiles')
    .where('role', '==', 'professional')
    .limit(100)
    .get();
  for (const item of snapshot.docs) {
    const profile = item.data() || {};
    if (profile.status !== 'approved') continue;
    const name = sanitizeText(profile.displayName || profile.email, 120) || 'Profissional';
    for (const patientId of Array.isArray(profile.linkedPatientIds) ? profile.linkedPatientIds : []) {
      if (!byPatient.has(patientId)) continue;
      const names = byPatient.get(patientId);
      if (!names.includes(name)) names.push(name);
    }
  }
  return byPatient;
}

async function resolveLegacyMediaPresence(context, patients, knownPatientsWithMedia) {
  const result = new Map();
  await mapWithConcurrency(patients, 6, async patient => {
    if (knownPatientsWithMedia.has(patient.id)) {
      result.set(patient.id, true);
      return;
    }
    const snapshot = await patientRef(context, patient.id)
      .collection('activityRecords')
      .where('status', 'in', ['active', 'delete_failed'])
      .limit(1)
      .get();
    result.set(patient.id, !snapshot.empty);
  });
  return result;
}

function getPatientStatus(sessionSummaries) {
  if (sessionSummaries.some(session => session.state === 'overdue')) return 'overdue';
  if (sessionSummaries.some(session => session.state === 'waiting')) return 'waiting';
  const applicable = sessionSummaries.filter(session => session.state !== 'not_applicable');
  if (applicable.length === 0) return 'idle';
  if (applicable.some(session => session.state === 'sent')) return 'sent';
  if (applicable.some(session => session.state === 'excused')) return 'excused';
  return 'idle';
}

function comparePatientItems(left, right) {
  const priority = { overdue: 0, waiting: 1, sent: 2, excused: 3, idle: 4 };
  const priorityDifference = priority[left.status] - priority[right.status];
  if (priorityDifference !== 0) return priorityDifference;
  if (left.status === 'overdue' && right.status === 'overdue') {
    const leftHours = Math.max(0, ...left.sessions.map(session => session.overdueHours || 0));
    const rightHours = Math.max(0, ...right.sessions.map(session => session.overdueHours || 0));
    if (rightHours !== leftHours) return rightHours - leftHours;
  }
  return String(left.patient.name || '').localeCompare(String(right.patient.name || ''), 'pt-BR');
}

function normalizeGalleryFilters(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.parseInt(input.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const status = ['all', 'overdue', 'waiting', 'sent', 'no-media', 'excused'].includes(input.status) ? input.status : 'all';
  const archive = ['active', 'archived', 'all'].includes(input.archive) ? input.archive : 'active';
  return {
    page,
    pageSize,
    status,
    archive,
    search: sanitizeText(input.search, 120).toLocaleLowerCase('pt-BR'),
    professional: sanitizeText(input.professional, 120),
    patientId: sanitizeText(input.patientId, 128) === 'all' ? '' : sanitizeText(input.patientId, 128),
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(input.dateFrom || '')) ? String(input.dateFrom) : '',
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(String(input.dateTo || '')) ? String(input.dateTo) : '',
  };
}

function sessionMatchesDateFilter(session, filters) {
  const date = String(session.date || '');
  if (filters.dateFrom && date < filters.dateFrom) return false;
  if (filters.dateTo && date > filters.dateTo) return false;
  return true;
}

export async function listActivityMediaPresence(context, rawEntries = []) {
  if (!['admin', 'professional'].includes(context.role)) {
    throw activityError(
      'activity-records/presence-access-denied',
      'Seu perfil não está autorizado a consultar o resumo de atividades.',
      403,
    );
  }

  const requestedBySessionId = new Map();
  for (const rawEntry of Array.isArray(rawEntries) ? rawEntries.slice(0, MAX_MONITORED_SESSIONS) : []) {
    const sessionId = sanitizeText(rawEntry?.sessionId || rawEntry?.id, 128);
    const patientId = sanitizeText(rawEntry?.patientId, 128);
    if (!sessionId || !patientId) continue;
    requestedBySessionId.set(sessionId, patientId);
  }

  if (requestedBySessionId.size === 0) {
    return { sessionIds: [], queryCount: 0, documentsRead: 0 };
  }

  const allowedPatientIds = context.role === 'professional'
    ? new Set(Array.isArray(context.allowedPatientIds) ? context.allowedPatientIds.map(String) : [])
    : null;
  const requestedSessionIds = [...requestedBySessionId.keys()];
  const snapshots = await getSnapshotsInChunks(
    requestedSessionIds.map(sessionId => activityUploadStatusRef(context, sessionId)),
  );

  const sessionIds = snapshots
    .filter(item => item.exists)
    .filter(item => {
      const data = item.data() || {};
      const requestedPatientId = requestedBySessionId.get(item.id);
      const storedPatientId = sanitizeText(data.patientId, 128);
      if (!storedPatientId || storedPatientId !== requestedPatientId) return false;
      if (allowedPatientIds && !allowedPatientIds.has(storedPatientId)) return false;
      return data.hasMedia === true || Number(data.mediaCount || 0) > 0;
    })
    .map(item => item.id)
    .sort();

  return {
    sessionIds,
    queryCount: Math.ceil(requestedSessionIds.length / 400),
    documentsRead: snapshots.length,
  };
}

export async function listProfessionalActivityGallery(context, rawFilters = {}, { summaryOnly = false } = {}) {
  const now = new Date();
  const filters = normalizeGalleryFilters(rawFilters);
  const monitoringStart = await getMonitoringStart(context);

  if (summaryOnly && !monitoringStart) {
    return {
      monitoringStart: null,
      metrics: calculateGalleryMetrics([], new Map(), null, now),
      items: [],
      professionals: [],
      patientOptions: [],
      total: 0,
      page: 1,
      pageSize: 0,
      hasMore: false,
    };
  }

  if (summaryOnly) {
    const activitySessions = await listAccessibleActivitySessions(context);
    const sessions = selectCurrentPackageRealizedSessions(activitySessions, now);
    const monitoredSessions = monitoringStart
      ? sessions.filter(session => {
          const endAt = getActivitySessionEndAt(session);
          return endAt && endAt.getTime() >= new Date(monitoringStart).getTime();
        })
      : [];
    const statusBySession = await getActivityStatusMap(context, monitoredSessions);
    return {
      monitoringStart,
      metrics: calculateGalleryMetrics(monitoredSessions, statusBySession, monitoringStart, now),
      items: [],
      professionals: [],
      patientOptions: [],
      total: 0,
      page: 1,
      pageSize: 0,
      hasMore: false,
    };
  }

  const patients = await listAccessiblePatients(context);
  const patientIds = patients.map(patient => patient.id);
  const [activitySessions, professionalAssignments] = await Promise.all([
    listAccessibleActivitySessions(context, patientIds),
    buildProfessionalAssignments(context, patients),
  ]);
  const sessions = selectCurrentPackageRealizedSessions(activitySessions, now);

  const monitoredSessions = monitoringStart
    ? sessions.filter(session => {
        const endAt = getActivitySessionEndAt(session);
        return endAt && endAt.getTime() >= new Date(monitoringStart).getTime();
      })
    : [];
  const statusBySession = await getActivityStatusMap(context, monitoredSessions);
  const sessionsByPatient = new Map(patientIds.map(patientId => [patientId, []]));
  const knownPatientsWithMedia = new Set();

  for (const session of monitoredSessions) {
    const statusRecord = statusBySession.get(session.id);
    const resolved = resolveActivityUploadState({ session, monitoringStart, statusRecord, now });
    const summary = {
      ...session,
      ...resolved,
      mediaCount: Math.max(0, Number(statusRecord?.mediaCount || 0)),
      lastUploadAt: statusRecord?.lastUploadAt || null,
      justification: statusRecord?.justification || null,
    };
    const target = sessionsByPatient.get(session.patientId);
    if (target) target.push(summary);
    if (statusRecord?.hasMedia) knownPatientsWithMedia.add(session.patientId);

  }

  const metrics = calculateGalleryMetrics(monitoredSessions, statusBySession, monitoringStart, now);

  // Monte primeiro os cartões somente com os resumos de sessão. A verificação de
  // mídias legadas é limitada aos pacientes da página atual, evitando uma leitura
  // por paciente em toda abertura da aba.
  const candidateItems = patients.map(patient => {
    const allSummaries = (sessionsByPatient.get(patient.id) || [])
      .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
    const filteredSessions = allSummaries.filter(session => sessionMatchesDateFilter(session, filters));
    const latestSession = allSummaries[0] || null;
    const latestUploadAt = allSummaries
      .map(session => session.lastUploadAt)
      .filter(Boolean)
      .sort((a, b) => String(b).localeCompare(String(a)))[0] || null;
    return {
      patient,
      professionalNames: professionalAssignments.get(patient.id) || [],
      latestSession,
      latestUploadAt,
      hasAnyMedia: knownPatientsWithMedia.has(patient.id) ? true : null,
      status: getPatientStatus(filteredSessions),
      pendingCount: filteredSessions.filter(session => ['waiting', 'overdue'].includes(session.state)).length,
      overdueCount: filteredSessions.filter(session => session.state === 'overdue').length,
      sessions: filteredSessions,
    };
  }).filter(item => {
    const isArchived = item.patient.status === 'Concluído';
    if (filters.archive === 'active' && isArchived) return false;
    if (filters.archive === 'archived' && !isArchived) return false;
    if (filters.patientId && item.patient.id !== filters.patientId) return false;
    if (filters.search && !String(item.patient.name || '').toLocaleLowerCase('pt-BR').includes(filters.search)) return false;
    if (filters.professional && filters.professional !== 'all' && !item.professionalNames.includes(filters.professional)) return false;
    if (filters.status !== 'all' && filters.status !== 'no-media' && item.status !== filters.status) return false;
    if ((filters.dateFrom || filters.dateTo) && item.sessions.length === 0) return false;
    return true;
  }).sort(comparePatientItems);

  // O filtro “sem mídia” precisa confirmar registros legados antes da paginação.
  // É uma consulta deliberadamente mais cara e só ocorre quando o usuário escolhe
  // esse filtro. Na visualização normal, no máximo uma página (20 por padrão) é verificada.
  let items;
  if (filters.status === 'no-media') {
    const legacyPresence = await resolveLegacyMediaPresence(context, candidateItems.map(item => item.patient), knownPatientsWithMedia);
    items = candidateItems
      .map(item => ({ ...item, hasAnyMedia: legacyPresence.get(item.patient.id) ?? item.hasAnyMedia }))
      .filter(item => !item.hasAnyMedia);
  } else {
    items = candidateItems;
  }

  const offset = (filters.page - 1) * filters.pageSize;
  const pagedItems = items.slice(offset, offset + filters.pageSize);

  return {
    monitoringStart,
    metrics,
    items: pagedItems,
    professionals: [...new Set([...professionalAssignments.values()].flat())].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    patientOptions: patients.map(patient => ({ id: patient.id, name: String(patient.name || '') })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    total: items.length,
    page: filters.page,
    pageSize: filters.pageSize,
    hasMore: offset + pagedItems.length < items.length,
  };
}

export function applyActivityRecordGallerySummary(transaction, context, recordRef, record, now = Timestamp.now()) {
  if (record.gallerySummaryAppliedAt) return false;
  const sessionIds = normalizeActivitySessionIds(record);
  for (const sessionId of sessionIds) {
    transaction.set(activityUploadStatusRef(context, sessionId), {
      sessionId,
      patientId: record.patientId,
      hasMedia: true,
      mediaCount: FieldValue.increment(1),
      lastUploadAt: now,
      lastUploadedByUserId: context.userId,
      lastUploadedByName: record.createdByName || context.actorName || 'Profissional',
      lastRecordId: record.id || recordRef.id,
      updatedAt: now,
    }, { merge: true });
  }
  transaction.set(recordRef, {
    sessionIds,
    gallerySummaryAppliedAt: now,
  }, { merge: true });
  const auditRef = activityAuditCollection(context).doc();
  transaction.set(auditRef, {
    patientId: record.patientId,
    sessionIds,
    recordId: record.id || recordRef.id,
    action: 'upload_completed',
    actorUserId: context.userId,
    actorName: record.createdByName || context.actorName || 'Profissional',
    createdAt: now,
    details: {
      mediaType: record.mediaType || '',
      fileName: record.fileName || '',
      visibility: record.visibility || '',
    },
  });
  return true;
}

export async function reconcileActivitySessionMediaStatus(context, patientId, sessionIds, actor = {}) {
  assertActivityPatientAccess(context, patientId);
  const normalizedSessionIds = [...new Set((sessionIds || []).map(value => String(value || '').trim()).filter(Boolean))];
  if (normalizedSessionIds.length === 0) return;
  const snapshot = await patientRef(context, patientId).collection('activityRecords').limit(500).get();
  const activeRecords = snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(record => ['active', 'delete_failed'].includes(record.status));
  const batch = getAdminDb().batch();
  const now = Timestamp.now();
  for (const sessionId of normalizedSessionIds) {
    const related = activeRecords.filter(record => normalizeActivitySessionIds(record).includes(sessionId));
    const latest = related.slice().sort((a, b) => {
      const left = a.updatedAt?.toMillis instanceof Function ? a.updatedAt.toMillis() : 0;
      const right = b.updatedAt?.toMillis instanceof Function ? b.updatedAt.toMillis() : 0;
      return right - left;
    })[0];
    batch.set(activityUploadStatusRef(context, sessionId), {
      sessionId,
      patientId,
      hasMedia: related.length > 0,
      mediaCount: related.length,
      lastUploadAt: latest?.updatedAt || latest?.createdAt || FieldValue.delete(),
      lastUploadedByUserId: latest?.createdByUserId || '',
      lastUploadedByName: latest?.createdByName || '',
      lastRecordId: latest?.id || '',
      updatedAt: now,
    }, { merge: true });
  }
  const auditRef = activityAuditCollection(context).doc();
  batch.set(auditRef, {
    patientId,
    sessionIds: normalizedSessionIds,
    action: actor.action || 'media_status_recalculated',
    actorUserId: context.userId,
    actorName: context.actorName || 'Profissional',
    createdAt: now,
    details: actor.details || {},
  });
  await batch.commit();
}

async function requireRealizedSession(context, patientId, sessionId) {
  assertActivityPatientAccess(context, patientId);
  const [patientSnapshot, sessionSnapshot] = await Promise.all([
    patientRef(context, patientId).get(),
    sessionRef(context, sessionId).get(),
  ]);
  if (!patientSnapshot.exists) throw activityError('activity-records/patient-not-found', 'O cadastro da criança não foi encontrado.', 404);
  if (!sessionSnapshot.exists) throw activityError('activity-records/session-not-found', 'A sessão selecionada não foi encontrada.', 404);
  const session = sessionSnapshot.data() || {};
  if (session.patientId !== patientId) throw activityError('activity-records/session-mismatch', 'A sessão selecionada não pertence a esta criança.', 409);
  if (session.status !== 'Realizada' || session.isBlocked) {
    throw activityError('activity-records/justification-not-allowed', 'A justificativa só pode ser registrada em uma sessão realizada.', 409);
  }
  return { patient: patientSnapshot.data(), session: { id: sessionId, ...session } };
}

export async function saveActivitySessionJustification(context, input) {
  const patientId = sanitizeText(input.patientId, 128);
  const sessionId = sanitizeText(input.sessionId, 128);
  const reason = sanitizeText(input.reason, 80).toLocaleLowerCase('pt-BR');
  const note = sanitizeText(input.note, 1000);
  if (!JUSTIFICATION_REASONS.has(reason)) throw activityError('activity-records/invalid-justification', 'Selecione uma justificativa válida.');
  if (reason === 'outro' && !note) throw activityError('activity-records/justification-note-required', 'Descreva a justificativa selecionada como Outro.');
  await requireRealizedSession(context, patientId, sessionId);

  const ref = activityUploadStatusRef(context, sessionId);
  const auditRef = activityAuditCollection(context).doc();
  const now = Timestamp.now();
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const existing = current.justification || null;
    if (existing?.active && context.role !== 'admin' && existing.createdByUserId !== context.userId) {
      throw activityError('activity-records/justification-access-denied', 'Somente o autor ou o administrador pode alterar esta justificativa.', 403);
    }
    const action = existing?.active ? 'justification_updated' : 'justification_created';
    const justification = {
      active: true,
      reason,
      note,
      createdAt: existing?.createdAt || now,
      createdByUserId: existing?.createdByUserId || context.userId,
      createdByName: existing?.createdByName || context.actorName || 'Profissional',
      updatedAt: now,
      updatedByUserId: context.userId,
      updatedByName: context.actorName || 'Profissional',
      ...(existing?.removedAt ? { removedAt: null } : {}),
      ...(existing?.removedByUserId ? { removedByUserId: '' } : {}),
      ...(existing?.removedByName ? { removedByName: '' } : {}),
    };
    transaction.set(ref, {
      sessionId,
      patientId,
      justification,
      updatedAt: now,
    }, { merge: true });
    transaction.set(auditRef, {
      patientId,
      sessionIds: [sessionId],
      action,
      actorUserId: context.userId,
      actorName: context.actorName || 'Profissional',
      createdAt: now,
      details: { reason, note },
    });
  });
  const updated = await ref.get();
  return normalizeStatusRecord(updated);
}

export async function removeActivitySessionJustification(context, input) {
  const patientId = sanitizeText(input.patientId, 128);
  const sessionId = sanitizeText(input.sessionId, 128);
  await requireRealizedSession(context, patientId, sessionId);
  const ref = activityUploadStatusRef(context, sessionId);
  const auditRef = activityAuditCollection(context).doc();
  const now = Timestamp.now();
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !snapshot.data()?.justification?.active) return;
    const current = snapshot.data().justification;
    if (context.role !== 'admin' && current.createdByUserId !== context.userId) {
      throw activityError('activity-records/justification-access-denied', 'Somente o autor ou o administrador pode remover esta justificativa.', 403);
    }
    transaction.set(ref, {
      justification: {
        ...current,
        active: false,
        updatedAt: now,
        updatedByUserId: context.userId,
        updatedByName: context.actorName || 'Profissional',
        removedAt: now,
        removedByUserId: context.userId,
        removedByName: context.actorName || 'Profissional',
      },
      updatedAt: now,
    }, { merge: true });
    transaction.set(auditRef, {
      patientId,
      sessionIds: [sessionId],
      action: 'justification_removed',
      actorUserId: context.userId,
      actorName: context.actorName || 'Profissional',
      createdAt: now,
      details: { previousReason: current.reason || '', previousNote: current.note || '' },
    });
  });
  const updated = await ref.get();
  return normalizeStatusRecord(updated);
}

export async function writeActivityAudit(context, input) {
  const patientId = sanitizeText(input.patientId, 128);
  if (patientId) assertActivityPatientAccess(context, patientId);
  const sessionIds = [...new Set((input.sessionIds || []).map(value => sanitizeText(value, 128)).filter(Boolean))].slice(0, 8);
  const ref = activityAuditCollection(context).doc();
  await ref.set({
    patientId,
    sessionIds,
    recordId: sanitizeText(input.recordId, 128),
    action: sanitizeText(input.action, 80),
    actorUserId: context.userId,
    actorName: context.actorName || 'Profissional',
    createdAt: Timestamp.now(),
    details: input.details && typeof input.details === 'object' ? input.details : {},
  });
}

export async function listActivitySessionAudit(context, input) {
  if (context.role !== 'admin' && context.actorEmail !== PRIMARY_ADMIN_EMAIL) {
    throw activityError('activity-records/audit-admin-required', 'O histórico completo é exclusivo do administrador.', 403);
  }
  const patientId = sanitizeText(input.patientId, 128);
  const sessionId = sanitizeText(input.sessionId, 128);
  assertActivityPatientAccess(context, patientId);
  const snapshot = await activityAuditCollection(context)
    .where('patientId', '==', patientId)
    .limit(200)
    .get();
  return snapshot.docs
    .map(item => ({ id: item.id, ...item.data(), createdAt: serializeDate(item.data().createdAt) }))
    .filter(item => !sessionId || (Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId)))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 100);
}
