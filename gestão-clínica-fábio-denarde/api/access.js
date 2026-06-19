import crypto from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyFirebaseRequest } from './_lib/firebaseAdmin.js';
import { ACCESS_CONTEXTS, ACCESS_ROLES as ACCESS_PROFILE_ROLES, normalizePermissionOverrides } from './_lib/accessPermissions.js';
import { notifyAccessApproval, notifyAccessRequest } from './_lib/accessRequestNotification.js';
import { canShareActivityWithGuardian } from './_lib/activityRecordsValidation.js';
import { buildResponsiblePackages, getPackageForMedia } from './_lib/responsiblePortalPackages.js';
import {
  assertOwnedPatientPhoto,
  assertOwnedResponsibleDocument,
  createResponsibleDocumentUploadSession,
  createSignedPhotoUrl,
  createSignedResponsibleDocumentUrl,
  getDriveFileMetadata,
} from './_lib/googleDrive.js';

const PRIMARY_ADMIN_EMAIL = 'fdenarde@gmail.com';
const DEFAULT_PROFESSIONAL_NAME = 'Fábio Denarde';
const ACCESS_ROLES = new Set(['professional', 'responsible']);
const ACCESS_STATUSES = new Set(['pending', 'approved', 'rejected', 'revoked', 'disabled', 'canceled']);
const REQUEST_STATUSES = new Set(['pending', 'approved', 'rejected', 'revoked', 'disabled', 'canceled']);
const ALLOWED_ORIGINS = new Set([
  'https://gestaoclinica-solucoes.vercel.app',
  'https://fdenarde.github.io',
  'http://localhost:3000',
  'http://localhost:3001',
]);
const PROFESSIONAL_NOTIFICATION_INITIAL_LIMIT = 20;
const PROFESSIONAL_NOTIFICATION_INCREMENTAL_LIMIT = 50;
const PROFESSIONAL_NOTIFICATION_MAX_PAGE_LIMIT = 50;
const PROFESSIONAL_NOTIFICATION_BULK_LIMIT = 100;
const PRIMARY_ADMIN_UID_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let primaryAdminUidCache = {
  uid: '',
  expiresAt: 0,
  inFlight: null,
};

function accessError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function setSecurityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  const origin = String(req.headers?.origin || '');
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    throw accessError('access/invalid-json', 'A solicitação enviada é inválida.');
  }
}

function normalizeText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeEmail(value) {
  return normalizeText(value, 254).toLowerCase();
}

function emailDocumentId(email) {
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

function requestDocumentId(email, uid) {
  return crypto.createHash('sha256').update(`${normalizeEmail(email)}:${String(uid)}`).digest('hex');
}

function validateRequest(body, decodedToken = null) {
  const displayName = normalizeText(body.displayName, 120);
  const email = normalizeEmail(body.email);
  const phone = normalizeText(body.phone, 24);
  const phoneDigits = phone.replace(/\D/g, '');
  const role = normalizeText(body.role, 20);
  const linkedPatientName = normalizeText(body.linkedPatientName, 120);
  const notes = normalizeText(body.notes, 1000);

  if (displayName.length < 3) throw accessError('access/invalid-name', 'Informe seu nome completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw accessError('access/invalid-email', 'Informe um e-mail válido.');
  }
  if (decodedToken && email !== normalizeEmail(decodedToken.email)) {
    throw accessError('access/email-mismatch', 'O e-mail informado não corresponde à conta autenticada.', 403);
  }
  if (!/^\d{10,11}$/.test(phoneDigits)) {
    throw accessError('access/invalid-phone', 'Informe um telefone válido com DDD.');
  }
  if (!ACCESS_ROLES.has(role)) {
    throw accessError('access/invalid-role', 'Selecione um tipo de acesso válido.');
  }
  if (role === 'responsible' && linkedPatientName.length < 2) {
    throw accessError('access/missing-patient', 'Informe o paciente ou atendente vinculado.');
  }

  return { displayName, email, phone, role, linkedPatientName, notes };
}

function serializeDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

function parseNotificationCursor(value) {
  const normalized = normalizeText(value, 40);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function normalizeClientContext(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    portalTab: normalizeText(source.portalTab, 40),
    actionLocation: normalizeText(source.actionLocation, 160),
    deviceType: normalizeText(source.deviceType, 40),
    browser: normalizeText(source.browser, 80),
    platform: normalizeText(source.platform, 100),
    viewport: normalizeText(source.viewport, 40),
    language: normalizeText(source.language, 30),
  };
}

function inferRequestClientContext(req, overrides = {}) {
  const userAgent = normalizeText(req?.headers?.['user-agent'], 500);
  let deviceType = 'Computador';
  if (/iPad|Tablet/i.test(userAgent)) deviceType = 'Tablet';
  else if (/Android|iPhone|iPod|Mobile/i.test(userAgent)) deviceType = 'Celular';

  let browser = 'Navegador não identificado';
  if (/Edg\//i.test(userAgent)) browser = 'Microsoft Edge';
  else if (/OPR\//i.test(userAgent)) browser = 'Opera';
  else if (/Chrome\//i.test(userAgent)) browser = 'Google Chrome';
  else if (/Firefox\//i.test(userAgent)) browser = 'Mozilla Firefox';
  else if (/Safari\//i.test(userAgent)) browser = 'Safari';

  let platform = 'Sistema não identificado';
  if (/Windows/i.test(userAgent)) platform = 'Windows';
  else if (/Android/i.test(userAgent)) platform = 'Android';
  else if (/iPhone|iPad|iPod/i.test(userAgent)) platform = 'iOS/iPadOS';
  else if (/Mac OS|Macintosh/i.test(userAgent)) platform = 'macOS';
  else if (/Linux/i.test(userAgent)) platform = 'Linux';

  return normalizeClientContext({
    deviceType,
    browser,
    platform,
    language: normalizeText(req?.headers?.['accept-language'], 30),
    ...overrides,
  });
}

function normalizePlaybackSummary(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    startedAt: normalizeText(source.startedAt, 40) || null,
    finishedAt: normalizeText(source.finishedAt, 40) || null,
    durationSeconds: clampNumber(source.durationSeconds, 0, 24 * 60 * 60),
    totalPlayedSeconds: clampNumber(source.totalPlayedSeconds, 0, 24 * 60 * 60),
    maxPositionSeconds: clampNumber(source.maxPositionSeconds, 0, 24 * 60 * 60),
    percentWatched: clampNumber(source.percentWatched, 0, 100),
    completed: source.completed === true,
    playCount: Math.round(clampNumber(source.playCount, 0, 10000)),
    pauseCount: Math.round(clampNumber(source.pauseCount, 0, 10000)),
    seekCount: Math.round(clampNumber(source.seekCount, 0, 10000)),
    viewDurationSeconds: clampNumber(source.viewDurationSeconds, 0, 24 * 60 * 60),
  };
}

function formatSecondsForAudit(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}min ${remaining}s`;
  if (minutes > 0) return `${minutes}min ${remaining}s`;
  return `${remaining}s`;
}

function notificationDetail(label, value, extra = {}) {
  return {
    label: normalizeText(label, 100),
    value: normalizeText(value, 2000),
    ...(extra.previousValue !== undefined
      ? { previousValue: normalizeText(extra.previousValue, 2000) }
      : {}),
    ...(extra.newValue !== undefined
      ? { newValue: normalizeText(extra.newValue, 2000) }
      : {}),
  };
}

function normalizeNotificationDetails(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 60).map(item => notificationDetail(
    item?.label,
    item?.value,
    {
      ...(item && Object.prototype.hasOwnProperty.call(item, 'previousValue') ? { previousValue: item.previousValue } : {}),
      ...(item && Object.prototype.hasOwnProperty.call(item, 'newValue') ? { newValue: item.newValue } : {}),
    },
  )).filter(item => item.label);
}

function serializeProfileContexts(value, role) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => normalizeText(item, 40))
    .filter(item => ACCESS_CONTEXTS.has(item) && item !== role))]
    .slice(0, 4);
}

function serializeProfileLinkedPatientIds(value) {
  return Array.isArray(value)
    ? [...new Set(value
      .filter(item => typeof item === 'string' && item.trim())
      .map(item => item.trim()))]
      .slice(0, 200)
    : [];
}

function serializeProfile(data) {
  if (!data) return null;
  const role = ACCESS_PROFILE_ROLES.has(data.role) ? data.role : 'professional';
  const workspaceId = normalizeText(data.workspaceId, 160);
  const permissionOverrides = normalizePermissionOverrides(data.permissionOverrides);
  return {
    uid: String(data.uid || ''),
    email: normalizeEmail(data.email),
    displayName: normalizeText(data.displayName, 120),
    phone: normalizeText(data.phone, 24),
    role,
    status: ACCESS_STATUSES.has(data.status) ? data.status : 'pending',
    createdAt: serializeDate(data.createdAt),
    approvedAt: serializeDate(data.approvedAt),
    approvedBy: data.approvedBy ? String(data.approvedBy) : null,
    revokedAt: serializeDate(data.revokedAt),
    revokedBy: data.revokedBy ? String(data.revokedBy) : null,
    revokedByEmail: data.revokedByEmail ? normalizeEmail(data.revokedByEmail) : null,
    linkedPatientIds: serializeProfileLinkedPatientIds(data.linkedPatientIds),
    linkedProfessionalIds: serializeProfileLinkedPatientIds(data.linkedProfessionalIds),
    provider: normalizeText(data.provider, 80),
    requestId: data.requestId ? String(data.requestId) : null,
    schemaVersion: Number.isFinite(Number(data.schemaVersion)) ? Number(data.schemaVersion) : 1,
    workspaceId: workspaceId || undefined,
    enabledContexts: serializeProfileContexts(data.enabledContexts, role),
    permissionOverrides,
    suspension: data.suspension && typeof data.suspension === 'object'
      ? {
        active: data.suspension.active === true,
        reason: normalizeText(data.suspension.reason, 300) || undefined,
        startedAt: serializeDate(data.suspension.startedAt),
        endsAt: serializeDate(data.suspension.endsAt),
      }
      : null,
    temporaryAccess: data.temporaryAccess && typeof data.temporaryAccess === 'object'
      ? {
        startsAt: serializeDate(data.temporaryAccess.startsAt),
        endsAt: serializeDate(data.temporaryAccess.endsAt),
      }
      : null,
    configurationVersion: Number.isFinite(Number(data.configurationVersion))
      ? Number(data.configurationVersion)
      : 1,
  };
}

function serializeLinkedPatientIds(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 3)
    : [];
}

function serializeRequest(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    uid: data.uid ? String(data.uid) : null,
    linkedPatientIds: serializeLinkedPatientIds(data.linkedPatientIds),
    email: normalizeEmail(data.email),
    displayName: normalizeText(data.displayName, 120),
    phone: normalizeText(data.phone, 24),
    role: ACCESS_ROLES.has(data.role) ? data.role : 'professional',
    linkedPatientName: normalizeText(data.linkedPatientName, 120),
    notes: normalizeText(data.notes, 1000),
    status: REQUEST_STATUSES.has(data.status) ? data.status : 'pending',
    submittedAt: serializeDate(data.submittedAt || data.createdAt),
    reviewedAt: serializeDate(data.reviewedAt || data.approvedAt || data.rejectedAt),
    reviewedBy: data.reviewedBy ? String(data.reviewedBy) : null,
    approvedAt: serializeDate(data.approvedAt),
    approvedBy: data.approvedBy ? String(data.approvedBy) : null,
    approvedByEmail: data.approvedByEmail ? normalizeEmail(data.approvedByEmail) : null,
    rejectedAt: serializeDate(data.rejectedAt),
    rejectedBy: data.rejectedBy ? String(data.rejectedBy) : null,
    rejectedByEmail: data.rejectedByEmail ? normalizeEmail(data.rejectedByEmail) : null,
    revokedAt: serializeDate(data.revokedAt),
    revokedBy: data.revokedBy ? String(data.revokedBy) : null,
    revokedByEmail: data.revokedByEmail ? normalizeEmail(data.revokedByEmail) : null,
    emailNotificationStatus: ['sent', 'skipped', 'failed'].includes(data.emailNotificationStatus)
      ? data.emailNotificationStatus
      : null,
    emailNotificationError: data.emailNotificationError
      ? normalizeText(data.emailNotificationError, 500)
      : null,
  };
}

function providerFromToken(decodedToken) {
  return normalizeText(decodedToken.firebase?.sign_in_provider || 'unknown', 80);
}

function requirePrimaryAdmin(decodedToken) {
  if (normalizeEmail(decodedToken?.email) !== PRIMARY_ADMIN_EMAIL) {
    throw accessError('access/admin-required', 'Esta operação é exclusiva do administrador.', 403);
  }
}

function resolvePlatformUrl(req) {
  const configured = process.env.ACCESS_PLATFORM_URL?.trim();
  if (configured) return configured;
  const origin = String(req.headers?.origin || '').trim();
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    const isPrivateLan = (
      /^192\.168\./.test(host)
      || /^10\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
    const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
    if (parsed.protocol === 'http:' && (isPrivateLan || isLoopback)) return origin;
  } catch {
    return '';
  }
  return '';
}

async function ensurePrimaryAdminProfile(db, decodedToken, existingSnapshot = null) {
  const ref = db.collection('accessProfiles').doc(decodedToken.uid);
  const initialSnapshot = existingSnapshot || await ref.get();
  const initial = initialSnapshot.exists ? initialSnapshot.data() : null;
  const alreadyCanonical = Boolean(
    initial
    && normalizeEmail(initial.email) === PRIMARY_ADMIN_EMAIL
    && initial.role === 'admin'
    && initial.status === 'approved',
  );
  if (alreadyCanonical) return initialSnapshot;

  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() : {};
    const isCanonical = (
      normalizeEmail(existing.email) === PRIMARY_ADMIN_EMAIL
      && existing.role === 'admin'
      && existing.status === 'approved'
    );
    if (isCanonical) return;

    transaction.set(ref, {
      uid: decodedToken.uid,
      email: PRIMARY_ADMIN_EMAIL,
      displayName: normalizeText(decodedToken.name || existing.displayName || 'Fábio Denarde', 120),
      phone: normalizeText(existing.phone, 24),
      role: 'admin',
      status: 'approved',
      createdAt: existing.createdAt || FieldValue.serverTimestamp(),
      approvedAt: existing.approvedAt || FieldValue.serverTimestamp(),
      approvedBy: existing.approvedBy || 'system:primary-admin',
      approvedByEmail: PRIMARY_ADMIN_EMAIL,
      linkedPatientIds: Array.isArray(existing.linkedPatientIds) ? existing.linkedPatientIds : [],
      provider: providerFromToken(decodedToken),
      requestId: existing.requestId || null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return ref.get();
}

async function findRequestByEmail(db, email) {
  const directSnapshot = await db.collection('accessRequests').doc(emailDocumentId(email)).get();
  if (directSnapshot.exists) return directSnapshot;

  const legacySnapshot = await db.collection('accessRequests')
    .where('email', '==', normalizeEmail(email))
    .limit(1)
    .get();
  return legacySnapshot.empty ? null : legacySnapshot.docs[0];
}

async function findProfilesByEmail(db, email) {
  const snapshot = await db.collection('accessProfiles')
    .where('email', '==', normalizeEmail(email))
    .limit(10)
    .get();
  return snapshot.docs;
}

async function getPrimaryAdminUid() {
  const now = Date.now();
  if (primaryAdminUidCache.uid && primaryAdminUidCache.expiresAt > now) {
    return primaryAdminUidCache.uid;
  }
  if (primaryAdminUidCache.inFlight) return primaryAdminUidCache.inFlight;

  primaryAdminUidCache.inFlight = getAuth().getUserByEmail(PRIMARY_ADMIN_EMAIL)
    .then(adminUser => {
      primaryAdminUidCache = {
        uid: adminUser.uid,
        expiresAt: Date.now() + PRIMARY_ADMIN_UID_CACHE_TTL_MS,
        inFlight: null,
      };
      return adminUser.uid;
    })
    .catch(error => {
      primaryAdminUidCache.inFlight = null;
      console.error('[ACCESS API] Não foi possível localizar o administrador principal:', error?.message || error);
      throw accessError(
        'access/admin-workspace-unavailable',
        'O workspace principal da clínica não está disponível.',
        503,
      );
    });

  return primaryAdminUidCache.inFlight;
}

async function migrateLegacyReviewedRequest(db, requestSnapshot) {
  if (!requestSnapshot?.exists) return null;
  const request = requestSnapshot.data();
  if (!['approved', 'rejected', 'revoked', 'disabled', 'canceled'].includes(request.status)) return null;

  const normalizedEmail = normalizeEmail(request.email);
  const approvalRef = db.collection('accessApprovals').doc(emailDocumentId(normalizedEmail));
  await approvalRef.set({
    email: normalizedEmail,
    normalizedEmail,
    displayName: normalizeText(request.displayName, 120),
    phone: normalizeText(request.phone, 24),
    role: ACCESS_ROLES.has(request.role) ? request.role : 'professional',
    status: request.status,
    linkedPatientIds: [],
    requestId: requestSnapshot.id,
    approvedAt: request.status === 'approved' ? request.approvedAt || request.reviewedAt || FieldValue.serverTimestamp() : null,
    approvedBy: request.status === 'approved' ? request.approvedBy || request.reviewedBy || PRIMARY_ADMIN_EMAIL : null,
    approvedByEmail: request.status === 'approved' ? request.approvedByEmail || PRIMARY_ADMIN_EMAIL : null,
    rejectedAt: request.status === 'rejected' ? request.rejectedAt || request.reviewedAt || FieldValue.serverTimestamp() : null,
    rejectedBy: request.status === 'rejected' ? request.rejectedBy || request.reviewedBy || PRIMARY_ADMIN_EMAIL : null,
    rejectedByEmail: request.status === 'rejected' ? request.rejectedByEmail || PRIMARY_ADMIN_EMAIL : null,
    revokedAt: request.status === 'revoked' ? request.revokedAt || request.reviewedAt || FieldValue.serverTimestamp() : null,
    revokedBy: request.status === 'revoked' ? request.revokedBy || request.reviewedBy || PRIMARY_ADMIN_EMAIL : null,
    revokedByEmail: request.status === 'revoked' ? request.revokedByEmail || PRIMARY_ADMIN_EMAIL : null,
    linkedUid: request.uid || null,
    createdAt: request.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return approvalRef.get();
}

async function materializeProfileFromApproval(db, decodedToken, approvalSnapshot) {
  const profileRef = db.collection('accessProfiles').doc(decodedToken.uid);

  await db.runTransaction(async transaction => {
    const [latestProfile, latestApproval] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(approvalSnapshot.ref),
    ]);
    if (!latestApproval.exists) {
      throw accessError('access/approval-not-found', 'A autorização de acesso não foi encontrada.', 404);
    }

    const approval = latestApproval.data();
    const currentProfile = latestProfile.exists ? latestProfile.data() : {};
    const status = ACCESS_STATUSES.has(approval.status)
      ? approval.status
      : 'pending';
    const linkedPatientIds = Array.isArray(approval.linkedPatientIds)
      ? approval.linkedPatientIds
      : Array.isArray(currentProfile.linkedPatientIds)
        ? currentProfile.linkedPatientIds
        : [];

    transaction.set(profileRef, {
      uid: decodedToken.uid,
      email: normalizeEmail(decodedToken.email),
      displayName: normalizeText(approval.displayName || decodedToken.name, 120),
      phone: normalizeText(approval.phone, 24),
      role: ACCESS_ROLES.has(approval.role) ? approval.role : 'professional',
      status,
      createdAt: currentProfile.createdAt || approval.createdAt || FieldValue.serverTimestamp(),
      approvedAt: status === 'approved' ? approval.approvedAt || FieldValue.serverTimestamp() : null,
      approvedBy: status === 'approved' ? approval.approvedBy || PRIMARY_ADMIN_EMAIL : null,
      approvedByEmail: status === 'approved' ? approval.approvedByEmail || PRIMARY_ADMIN_EMAIL : null,
      revokedAt: status === 'revoked' ? approval.revokedAt || FieldValue.serverTimestamp() : null,
      revokedBy: status === 'revoked' ? approval.revokedBy || PRIMARY_ADMIN_EMAIL : null,
      revokedByEmail: status === 'revoked' ? approval.revokedByEmail || PRIMARY_ADMIN_EMAIL : null,
      linkedPatientIds,
      provider: providerFromToken(decodedToken),
      requestId: approval.requestId || null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(latestApproval.ref, {
      linkedUid: decodedToken.uid,
      firstLoginAt: approval.firstLoginAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const requestRef = approval.requestId
      ? db.collection('accessRequests').doc(String(approval.requestId))
      : null;
    if (requestRef) {
      transaction.set(requestRef, {
        uid: decodedToken.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  return profileRef.get();
}

async function createPendingProfileFromRequest(db, decodedToken, requestSnapshot) {
  const request = requestSnapshot.data();
  const profileRef = db.collection('accessProfiles').doc(decodedToken.uid);
  await profileRef.set({
    uid: decodedToken.uid,
    email: normalizeEmail(decodedToken.email),
    displayName: normalizeText(request.displayName || decodedToken.name, 120),
    phone: normalizeText(request.phone, 24),
    role: ACCESS_ROLES.has(request.role) ? request.role : 'professional',
    status: 'pending',
    createdAt: request.createdAt || FieldValue.serverTimestamp(),
    approvedAt: null,
    approvedBy: null,
    revokedAt: null,
    revokedBy: null,
    revokedByEmail: null,
    linkedPatientIds: [],
    provider: providerFromToken(decodedToken),
    requestId: requestSnapshot.id,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await requestSnapshot.ref.set({
    uid: decodedToken.uid,
    provider: providerFromToken(decodedToken),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return profileRef.get();
}

async function getProfile(db, decodedToken) {
  const normalizedEmail = normalizeEmail(decodedToken.email);
  const profileRef = db.collection('accessProfiles').doc(decodedToken.uid);
  const profileSnapshot = await profileRef.get();

  if (normalizedEmail === PRIMARY_ADMIN_EMAIL) {
    return ensurePrimaryAdminProfile(db, decodedToken, profileSnapshot);
  }

  if (profileSnapshot.exists) {
    return profileSnapshot;
  }

  let approvalSnapshot = await db.collection('accessApprovals')
    .doc(emailDocumentId(normalizedEmail))
    .get();

  const requestSnapshot = await findRequestByEmail(db, normalizedEmail);
  if (!approvalSnapshot.exists) {
    approvalSnapshot = await migrateLegacyReviewedRequest(db, requestSnapshot);
  }

  if (approvalSnapshot?.exists) {
    return materializeProfileFromApproval(db, decodedToken, approvalSnapshot);
  }

  return requestSnapshot
    ? createPendingProfileFromRequest(db, decodedToken, requestSnapshot)
    : profileSnapshot;
}

async function createPendingRequest(db, decodedToken, input) {
  if (!decodedToken?.uid || !decodedToken?.email) {
    throw accessError(
      'access/auth-account-required',
      'Crie ou entre em uma conta Firebase antes de enviar a solicitação.',
      401,
    );
  }

  const requestRef = db.collection('accessRequests').doc(requestDocumentId(input.email, decodedToken.uid));
  const approvalRef = db.collection('accessApprovals').doc(emailDocumentId(input.email));
  const profileRef = db.collection('accessProfiles').doc(decodedToken.uid);

  await db.runTransaction(async transaction => {
    const requestSnapshot = await transaction.get(requestRef);
    const approvalSnapshot = await transaction.get(approvalRef);
    const currentRequest = requestSnapshot.exists ? requestSnapshot.data() : {};
    const approval = approvalSnapshot.exists ? approvalSnapshot.data() : {};
    const profileSnapshot = await transaction.get(profileRef);
    const currentProfile = profileSnapshot.exists ? profileSnapshot.data() : {};

    if (approval.status === 'approved' || currentProfile.status === 'approved' || currentProfile.role === 'admin') {
      throw accessError('access/already-approved', 'Este acesso já está aprovado.', 409);
    }
    if (approval.status === 'disabled' || currentProfile.status === 'disabled') {
      throw accessError('access/disabled', 'Este acesso está desativado. Entre em contato com a administração.', 403);
    }

    transaction.set(requestRef, {
      uid: decodedToken.uid,
      linkedPatientIds: [],
      email: input.email,
      normalizedEmail: input.email,
      displayName: input.displayName,
      phone: input.phone,
      role: input.role,
      linkedPatientName: input.linkedPatientName,
      notes: input.notes,
      provider: providerFromToken(decodedToken),
      status: 'pending',
      createdAt: currentRequest.createdAt || FieldValue.serverTimestamp(),
      submittedAt: FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      approvedAt: null,
      approvedBy: null,
      approvedByEmail: null,
      rejectedAt: null,
      rejectedBy: null,
      rejectedByEmail: null,
      revokedAt: null,
      revokedBy: null,
      revokedByEmail: null,
      emailNotificationStatus: null,
      emailNotificationError: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(approvalRef, {
      email: input.email,
      normalizedEmail: input.email,
      displayName: input.displayName,
      phone: input.phone,
      role: input.role,
      status: 'pending',
      linkedPatientIds: [],
      requestId: requestRef.id,
      approvedAt: null,
      approvedBy: null,
      approvedByEmail: null,
      rejectedAt: null,
      rejectedBy: null,
      rejectedByEmail: null,
      linkedUid: decodedToken.uid,
      createdAt: approval.createdAt || currentRequest.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(profileRef, {
      uid: decodedToken.uid,
      email: input.email,
      displayName: input.displayName,
      phone: input.phone,
      role: input.role,
      status: 'pending',
      createdAt: currentProfile.createdAt || FieldValue.serverTimestamp(),
      approvedAt: null,
      approvedBy: null,
      approvedByEmail: null,
      revokedAt: null,
      revokedBy: null,
      revokedByEmail: null,
      linkedPatientIds: [],
      provider: providerFromToken(decodedToken),
      requestId: requestRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return {
    request: await requestRef.get(),
    profile: await profileRef.get(),
  };
}

async function notifyAdminAndRecord(requestSnapshot, input) {
  let notification = { status: 'skipped' };
  let notificationError = null;
  try {
    notification = await notifyAccessRequest({
      uid: requestSnapshot.data().uid || requestSnapshot.id,
      ...input,
    });
  } catch (error) {
    notification = { status: 'failed' };
    notificationError = normalizeText(error?.message || error, 500);
    console.error('[ACCESS API] Solicitação salva, mas a notificação ao administrador falhou:', notificationError);
  }

  try {
    await requestSnapshot.ref.set({
      adminNotificationStatus: notification.status,
      adminNotificationId: notification.id || null,
      adminNotificationError: notificationError,
      adminNotificationUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.error('[ACCESS API] O status da notificação ao administrador não pôde ser atualizado:', error?.message || error);
  }
}

async function listAccessRequests(db) {
  const snapshot = await db.collection('accessRequests').limit(200).get();
  return snapshot.docs
    .map(serializeRequest)
    .sort((a, b) => {
      const aDate = a.reviewedAt || a.submittedAt || '';
      const bDate = b.reviewedAt || b.submittedAt || '';
      return String(bDate).localeCompare(String(aDate));
    });
}

async function resolveUidForEmail(email, requestUid) {
  if (requestUid) {
    try {
      const authUser = await getAuth().getUser(String(requestUid));
      if (normalizeEmail(authUser.email) === normalizeEmail(email)) return authUser.uid;
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
  }
  try {
    const authUser = await getAuth().getUserByEmail(normalizeEmail(email));
    return authUser.uid;
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return '';
    throw error;
  }
}

async function reviewRequest(db, decodedToken, body, platformUrl) {
  const requestId = normalizeText(body.requestId, 128);
  const decision = normalizeText(body.decision, 20);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
    throw accessError('access/invalid-request-id', 'A solicitação informada é inválida.');
  }
  if (!['approve', 'reject'].includes(decision)) {
    throw accessError('access/invalid-decision', 'Selecione uma decisão válida.');
  }

  const requestRef = db.collection('accessRequests').doc(requestId);
  const initialRequestSnapshot = await requestRef.get();
  if (!initialRequestSnapshot.exists) {
    throw accessError('access/request-not-found', 'A solicitação não foi encontrada.', 404);
  }

  const initialRequest = initialRequestSnapshot.data();
  const normalizedEmail = normalizeEmail(initialRequest.email);
  const approvalRef = db.collection('accessApprovals').doc(emailDocumentId(normalizedEmail));
  const resolvedUid = await resolveUidForEmail(normalizedEmail, initialRequest.uid);
  const matchingProfiles = await findProfilesByEmail(db, normalizedEmail);
  const profileRefs = new Map(matchingProfiles.map(snapshot => [snapshot.id, snapshot.ref]));
  if (resolvedUid) profileRefs.set(resolvedUid, db.collection('accessProfiles').doc(resolvedUid));

  const reviewedBy = decodedToken.uid;
  const reviewedByEmail = normalizeEmail(decodedToken.email);
  const approved = decision === 'approve';
  if (approved && !resolvedUid) {
    throw accessError(
      'access/missing-linked-user',
      'Esta solicitação ainda não possui uma conta Firebase vinculada. Peça ao usuário para criar o cadastro com e-mail e senha ou entrar com Google usando o mesmo e-mail.',
      409,
    );
  }

  await db.runTransaction(async transaction => {
    const requestSnapshot = await transaction.get(requestRef);
    const approvalSnapshot = await transaction.get(approvalRef);
    if (!requestSnapshot.exists) {
      throw accessError('access/request-not-found', 'A solicitação não foi encontrada.', 404);
    }

    const request = requestSnapshot.data();
    const approval = approvalSnapshot.exists ? approvalSnapshot.data() : {};
    const status = approved ? 'approved' : 'rejected';

    transaction.set(requestRef, {
      uid: resolvedUid || request.uid || null,
      normalizedEmail,
      status,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy,
      approvedAt: approved ? FieldValue.serverTimestamp() : null,
      approvedBy: approved ? reviewedBy : null,
      approvedByEmail: approved ? reviewedByEmail : null,
      rejectedAt: approved ? null : FieldValue.serverTimestamp(),
      rejectedBy: approved ? null : reviewedBy,
      rejectedByEmail: approved ? null : reviewedByEmail,
      emailNotificationStatus: approved ? 'skipped' : null,
      emailNotificationError: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(approvalRef, {
      email: normalizedEmail,
      normalizedEmail,
      displayName: normalizeText(request.displayName, 120),
      phone: normalizeText(request.phone, 24),
      role: ACCESS_ROLES.has(request.role) ? request.role : 'professional',
      status,
      linkedPatientIds: Array.isArray(approval.linkedPatientIds) ? approval.linkedPatientIds : [],
      requestId,
      approvedAt: approved ? FieldValue.serverTimestamp() : null,
      approvedBy: approved ? reviewedBy : null,
      approvedByEmail: approved ? reviewedByEmail : null,
      rejectedAt: approved ? null : FieldValue.serverTimestamp(),
      rejectedBy: approved ? null : reviewedBy,
      rejectedByEmail: approved ? null : reviewedByEmail,
      linkedUid: resolvedUid || approval.linkedUid || null,
      createdAt: approval.createdAt || request.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    for (const [uid, profileRef] of profileRefs) {
      transaction.set(profileRef, {
        uid,
        email: normalizedEmail,
        displayName: normalizeText(request.displayName, 120),
        phone: normalizeText(request.phone, 24),
        role: ACCESS_ROLES.has(request.role) ? request.role : 'professional',
        status,
        createdAt: request.createdAt || FieldValue.serverTimestamp(),
        approvedAt: approved ? FieldValue.serverTimestamp() : null,
        approvedBy: approved ? reviewedBy : null,
        approvedByEmail: approved ? reviewedByEmail : null,
        linkedPatientIds: Array.isArray(approval.linkedPatientIds) ? approval.linkedPatientIds : [],
        provider: normalizeText(request.provider, 80) || 'approved-request',
        requestId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  if (approved) {
    let emailNotification = { status: 'skipped' };
    let emailNotificationError = null;
    try {
      emailNotification = await notifyAccessApproval({
        requestId,
        displayName: normalizeText(initialRequest.displayName, 120),
        email: normalizedEmail,
        platformUrl: normalizeText(platformUrl, 500),
      });
    } catch (error) {
      emailNotification = { status: 'failed' };
      emailNotificationError = 'Não foi possível enviar o e-mail de aprovação.';
      console.error('[ACCESS API] Acesso aprovado, mas o e-mail de confirmação falhou:', error?.message || error);
    }

    try {
      await requestRef.set({
        emailNotificationStatus: emailNotification.status,
        emailNotificationId: emailNotification.id || null,
        emailNotificationError,
        emailNotificationUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.error(
        '[ACCESS API] A aprovação foi salva, mas o status do e-mail não pôde ser atualizado:',
        error?.message || error,
      );
    }
  }

  return requestRef.get();
}

async function linkResponsiblePatient(db, decodedToken, body) {
  const requestId = normalizeText(body.requestId, 128);
  const patientId = normalizeText(body.patientId, 128);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
    throw accessError('access/invalid-request-id', 'A solicitação informada é inválida.');
  }
  if (!patientId || patientId.includes('/')) {
    throw accessError('access/invalid-patient-id', 'Selecione um paciente válido.');
  }

  const requestRef = db.collection('accessRequests').doc(requestId);
  const patientRef = db.doc(`users/${decodedToken.uid}/patients/${patientId}`);
  const [requestSnapshot, patientSnapshot] = await Promise.all([
    requestRef.get(),
    patientRef.get(),
  ]);
  if (!requestSnapshot.exists) {
    throw accessError('access/request-not-found', 'A solicitação não foi encontrada.', 404);
  }
  if (!patientSnapshot.exists) {
    throw accessError('access/patient-not-found', 'O paciente selecionado não foi encontrado.', 404);
  }

  const request = requestSnapshot.data();
  if (request.role !== 'responsible') {
    throw accessError(
      'access/invalid-responsible-request',
      'Somente solicitações de responsável podem receber vínculo com paciente.',
      409,
    );
  }
  if (!['pending', 'approved'].includes(request.status)) {
    throw accessError(
      'access/responsible-link-unavailable',
      'O vínculo só pode ser alterado para solicitações pendentes ou aprovadas.',
      409,
    );
  }

  const normalizedEmail = normalizeEmail(request.email);
  const approvalRef = db.collection('accessApprovals').doc(emailDocumentId(normalizedEmail));
  const resolvedUid = await resolveUidForEmail(normalizedEmail, request.uid);
  const matchingProfiles = await findProfilesByEmail(db, normalizedEmail);
  const profileRefs = new Map(matchingProfiles.map(snapshot => [snapshot.id, snapshot.ref]));
  if (resolvedUid) profileRefs.set(resolvedUid, db.collection('accessProfiles').doc(resolvedUid));
  await db.runTransaction(async transaction => {
    const [latestRequest, latestApproval] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(approvalRef),
    ]);
    if (!latestRequest.exists) {
      throw accessError('access/request-not-found', 'A solicitação não foi encontrada.', 404);
    }
    const currentRequest = latestRequest.data();
    const approval = latestApproval.exists ? latestApproval.data() : {};
    const existingLinkedPatientIds = serializeLinkedPatientIds(
      Array.isArray(currentRequest.linkedPatientIds) && currentRequest.linkedPatientIds.length > 0
        ? currentRequest.linkedPatientIds
        : approval.linkedPatientIds,
    );
    const linkedPatientIds = [...new Set([...existingLinkedPatientIds, patientId])].slice(0, 3);
    if (currentRequest.role !== 'responsible') {
      throw accessError(
        'access/invalid-responsible-request',
        'Esta solicitação não pertence a um responsável.',
        409,
      );
    }
    if (!['pending', 'approved'].includes(currentRequest.status)) {
      throw accessError(
        'access/responsible-link-unavailable',
        'O vínculo deste acesso não pode mais ser alterado.',
        409,
      );
    }

    transaction.set(requestRef, {
      linkedPatientIds,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(approvalRef, {
      email: normalizedEmail,
      normalizedEmail,
      displayName: normalizeText(currentRequest.displayName, 120),
      phone: normalizeText(currentRequest.phone, 24),
      role: 'responsible',
      status: ACCESS_STATUSES.has(currentRequest.status) ? currentRequest.status : 'pending',
      linkedPatientIds,
      requestId,
      linkedUid: resolvedUid || approval.linkedUid || null,
      createdAt: approval.createdAt || currentRequest.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    for (const [uid, profileRef] of profileRefs) {
      transaction.set(profileRef, {
        uid,
        email: normalizedEmail,
        displayName: normalizeText(currentRequest.displayName, 120),
        phone: normalizeText(currentRequest.phone, 24),
        role: 'responsible',
        status: ACCESS_STATUSES.has(currentRequest.status) ? currentRequest.status : 'pending',
        linkedPatientIds,
        requestId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  return requestRef.get();
}

function normalizeResponsibleSessionType(value) {
  const type = normalizeText(value, 120);
  if (!type || type === 'Sessão simples (50 min)' || type === 'Sessão simples') return 'Intervenção';
  return type;
}

function serializeResponsibleSession(snapshot) {
  const data = snapshot.data();
  const professionalName = normalizeText(
    data.professionalName || data.therapistName || data.providerName || DEFAULT_PROFESSIONAL_NAME,
    120,
  );
  return {
    id: snapshot.id,
    patientId: normalizeText(data.patientId, 128),
    date: normalizeText(data.date, 10),
    time: normalizeText(data.time, 5),
    status: normalizeText(data.status, 40) || 'Agendada',
    type: normalizeResponsibleSessionType(data.type),
    professionalName: professionalName || DEFAULT_PROFESSIONAL_NAME,
    notes: normalizeText(data.notes, 500),
    source: normalizeText(data.source, 30) || null,
    isBlocked: data.isBlocked === true,
    consumesPackage: data.consumesPackage === true
      || data.consumePackageSession === true
      || data.countsTowardPackage === true,
  };
}

function serializeResponsibleMedia(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    patientId: normalizeText(data.patientId, 128),
    sessionId: normalizeText(data.sessionId, 128),
    sessionDate: normalizeText(data.sessionDate, 10),
    sessionTime: normalizeText(data.sessionTime, 5),
    sessionNumber: Number.isFinite(Number(data.sessionNumber)) && Number(data.sessionNumber) > 0
      ? Number(data.sessionNumber)
      : null,
    sessionType: normalizeResponsibleSessionType(data.sessionType),
    sessionStatus: normalizeText(data.sessionStatusSnapshot, 40),
    category: normalizeText(data.category, 80) || 'Atividade',
    description: normalizeText(data.description, 2000),
    professionalName: normalizeText(data.createdByName, 120) || DEFAULT_PROFESSIONAL_NAME,
    mediaType: data.mediaType === 'video' || String(data.mimeType || '').startsWith('video/')
      ? 'video'
      : 'photo',
    fileName: normalizeText(data.fileName, 180) || 'mídia',
    mimeType: normalizeText(data.mimeType, 80),
    durationSeconds: Number.isFinite(Number(data.durationSeconds))
      ? Number(data.durationSeconds)
      : null,
    visibility: normalizeText(data.visibility, 40),
    shareStatus: normalizeText(data.shareStatus, 40),
    createdAt: serializeDate(data.createdAt),
  };
}

function serializeResponsiblePayment(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    patientId: normalizeText(data.patientId, 128),
    amount: Number.isFinite(Number(data.amount)) ? Number(data.amount) : 0,
    date: normalizeText(data.date, 10),
    installment: normalizeText(data.installment, 80),
    method: normalizeText(data.method, 40),
    packageNumber: Number.isFinite(Number(data.packageNumber)) && Number(data.packageNumber) > 0
      ? Number(data.packageNumber)
      : null,
  };
}

function serializeResponsibleDocument(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    patientId: normalizeText(data.patientId, 128),
    fileName: normalizeText(data.fileName, 220) || 'documento',
    mimeType: normalizeText(data.mimeType, 120),
    sizeBytes: Number.isFinite(Number(data.sizeBytes)) ? Number(data.sizeBytes) : 0,
    category: normalizeText(data.category, 120) || 'Outro',
    note: normalizeText(data.note, 1000),
    uploadedByName: normalizeText(data.responsibleName, 120) || 'Responsável',
    createdAt: serializeDate(data.createdAt),
    status: normalizeText(data.status, 30) || 'available',
  };
}

function getPackagePaymentSummary(payments, packageNumber) {
  const sorted = [...payments].sort((a, b) => `${a.date}|${a.id}`.localeCompare(`${b.date}|${b.id}`));
  const explicit = sorted.filter(payment => payment.packageNumber === packageNumber);
  const totalPaid = sorted.reduce((sum, payment) => sum + payment.amount, 0);
  const inferred = Math.min(Math.max(totalPaid - ((packageNumber - 1) * 1000), 0), 1000);
  const explicitPaid = explicit.reduce((sum, payment) => sum + payment.amount, 0);
  const paidAmount = Math.max(explicitPaid, inferred);
  return {
    financialStatus: paidAmount >= 1000 ? 'quitado' : 'pendente',
    paidAmount,
    pendingAmount: Math.max(1000 - paidAmount, 0),
    installments: explicit.length > 0 ? explicit : sorted.filter(payment => {
      if (payment.packageNumber) return false;
      const paidBefore = sorted
        .filter(candidate => `${candidate.date}|${candidate.id}` < `${payment.date}|${payment.id}`)
        .reduce((sum, candidate) => sum + candidate.amount, 0);
      const firstPackage = Math.floor(paidBefore / 1000) + 1;
      const lastPackage = Math.floor(Math.max(paidBefore + payment.amount - 0.01, 0) / 1000) + 1;
      return packageNumber >= firstPackage && packageNumber <= lastPackage;
    }),
  };
}

function serializePortalSettings(data = {}) {
  return {
    name: normalizeText(data.name, 120) || 'Denarde Soluções',
    title: normalizeText(data.title, 160) || 'Gestão Clínica e Acompanhamento',
    email: normalizeEmail(data.email),
    whatsapp: normalizeText(data.whatsapp, 30),
    address: normalizeText(data.address, 300),
    visualTheme: ['current', 'calm-tech', 'health-balance', 'soft-welcome'].includes(data.visualTheme)
      ? data.visualTheme
      : 'calm-tech',
  };
}

function aggregateMediaInteractions(snapshots, responsibleUid) {
  const byRecord = new Map();
  for (const snapshot of snapshots) {
    const data = snapshot.data();
    const recordId = normalizeText(data.recordId, 128);
    if (!recordId) continue;
    const current = byRecord.get(recordId) || { likeCount: 0, likedByCurrentResponsible: false, comments: [] };
    if (data.type === 'like' && data.active !== false) {
      current.likeCount += 1;
      if (data.responsibleUid === responsibleUid) current.likedByCurrentResponsible = true;
    }
    if (data.type === 'comment' && data.active !== false) {
      current.comments.push({
        id: snapshot.id,
        responsibleName: normalizeText(data.responsibleName, 120) || 'Responsável',
        comment: normalizeText(data.comment, 1000),
        createdAt: serializeDate(data.createdAt),
        isOwn: data.responsibleUid === responsibleUid,
      });
    }
    byRecord.set(recordId, current);
  }
  for (const value of byRecord.values()) {
    value.comments.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }
  return byRecord;
}

async function requireInternalNotificationContext(db, decodedToken) {
  const profileSnapshot = await getProfile(db, decodedToken);
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  if (!profile || profile.status !== 'approved' || !['admin', 'professional'].includes(profile.role)) {
    throw accessError('access/internal-approved-required', 'Acesso profissional aprovado obrigatório.', 403);
  }
  return {
    profile,
    ownerUserId: normalizeEmail(decodedToken.email) === PRIMARY_ADMIN_EMAIL
      ? decodedToken.uid
      : await getPrimaryAdminUid(),
  };
}

function notificationCategoryForType(type) {
  if (type === 'portal_access') return 'login';
  if (type === 'gallery_access') return 'gallery';
  if (type === 'patient_profile_update') return 'profile_update';
  if (type === 'patient_document_upload') return 'document';
  if (type === 'access_blocked' || type === 'access_revoked') return 'access';
  return 'system';
}

function notificationPriorityForData(data = {}) {
  if (['urgent', 'important', 'informational'].includes(data.priority)) return data.priority;
  const type = normalizeText(data.type, 80);
  if (type === 'patient_document_upload') return 'important';
  if (type === 'patient_profile_update') {
    const changed = Array.isArray(data.changedFields) ? data.changedFields : [];
    return changed.some(field => ['medication', 'allergies', 'emergencyContact', 'doctorName'].includes(field))
      ? 'urgent'
      : 'important';
  }
  if (type === 'access_blocked' || type === 'access_revoked') return 'urgent';
  return 'informational';
}

function notificationPendingForType(type) {
  return type === 'patient_profile_update' || type === 'patient_document_upload';
}

function notificationProtectedFromDeletion(type) {
  return type === 'patient_profile_update' || type === 'patient_document_upload';
}

function notificationLifecycleForData(data = {}) {
  const type = normalizeText(data.type, 80);
  const inferredPending = notificationPendingForType(type);
  const completed = data.completed === true;
  const archived = data.archived === true;
  const ignored = data.ignored === true;
  const pendingAction = data.pendingAction === true || (inferredPending && !completed);
  let status = normalizeText(data.status, 24);
  if (!['active', 'pending', 'completed', 'archived', 'ignored'].includes(status)) {
    status = ignored ? 'ignored' : archived ? 'archived' : completed ? 'completed' : pendingAction ? 'pending' : 'active';
  }
  return {
    category: notificationCategoryForType(type),
    priority: notificationPriorityForData(data),
    status,
    pendingAction,
    completed,
    archived,
    ignored,
    protectedFromDeletion: notificationProtectedFromDeletion(type),
  };
}

function notificationBaseFields(type, extra = {}) {
  const pendingAction = notificationPendingForType(type);
  return {
    category: notificationCategoryForType(type),
    priority: notificationPriorityForData({ type, ...extra }),
    status: pendingAction ? 'pending' : 'active',
    pendingAction,
    completed: false,
    archived: false,
    ignored: false,
  };
}

function serializeProfessionalNotification(snapshot) {
  const data = snapshot.data();
  const clientContext = data.clientContext && typeof data.clientContext === 'object'
    ? normalizeClientContext(data.clientContext)
    : null;
  const lifecycle = notificationLifecycleForData(data);
  return {
    id: snapshot.id,
    title: normalizeText(data.title, 180) || 'Atividade no Portal do Responsável',
    message: normalizeText(data.message, 500) || 'Nova atividade no Portal do Responsável.',
    type: normalizeText(data.type, 80),
    patientId: normalizeText(data.patientId, 128),
    patientName: normalizeText(data.patientName, 120),
    responsibleName: normalizeText(data.responsibleName, 120),
    responsibleEmail: normalizeEmail(data.responsibleEmail),
    recordId: data.recordId ? normalizeText(data.recordId, 128) : null,
    documentId: data.documentId ? normalizeText(data.documentId, 128) : null,
    mediaFileName: data.mediaFileName ? normalizeText(data.mediaFileName, 220) : null,
    mediaType: data.mediaType === 'video' ? 'video' : (data.mediaType === 'photo' ? 'photo' : null),
    mediaCategory: data.mediaCategory ? normalizeText(data.mediaCategory, 120) : null,
    mediaDescription: data.mediaDescription ? normalizeText(data.mediaDescription, 2000) : null,
    sessionId: data.sessionId ? normalizeText(data.sessionId, 128) : null,
    sessionDate: data.sessionDate ? normalizeText(data.sessionDate, 10) : null,
    sessionTime: data.sessionTime ? normalizeText(data.sessionTime, 8) : null,
    sessionNumber: Number.isFinite(Number(data.sessionNumber)) && Number(data.sessionNumber) > 0
      ? Number(data.sessionNumber)
      : null,
    playback: data.playback && typeof data.playback === 'object' ? normalizePlaybackSummary(data.playback) : null,
    interactionSessionId: data.interactionSessionId ? normalizeText(data.interactionSessionId, 128) : null,
    actionLocation: normalizeText(data.actionLocation || clientContext?.actionLocation, 160),
    actionTarget: normalizeText(data.actionTarget, 240),
    navigationTarget: ['patient_gallery', 'patient_profile', 'patient_documents'].includes(data.navigationTarget)
      ? data.navigationTarget
      : 'none',
    details: normalizeNotificationDetails(data.details),
    clientContext,
    ...lifecycle,
    read: data.read === true,
    readAt: serializeDate(data.readAt),
    completedAt: serializeDate(data.completedAt),
    archivedAt: serializeDate(data.archivedAt),
    createdAt: serializeDate(data.createdAt),
    updatedAt: serializeDate(data.updatedAt || data.createdAt),
  };
}

async function listProfessionalNotifications(db, decodedToken, req) {
  const { ownerUserId } = await requireInternalNotificationContext(db, decodedToken);
  const updatedAfter = parseNotificationCursor(req?.query?.updatedAfter);
  const before = parseNotificationCursor(req?.query?.before);
  const requestedLimit = Math.max(1, Math.min(PROFESSIONAL_NOTIFICATION_MAX_PAGE_LIMIT, Number(req?.query?.limit) || PROFESSIONAL_NOTIFICATION_INITIAL_LIMIT));
  const collectionRef = db.collection(`users/${ownerUserId}/portalNotifications`);

  let snapshot;
  let incremental = false;
  if (updatedAfter) {
    incremental = true;
    snapshot = await collectionRef
      .where('updatedAt', '>', updatedAfter)
      .orderBy('updatedAt', 'asc')
      .limit(PROFESSIONAL_NOTIFICATION_INCREMENTAL_LIMIT)
      .get();
  } else {
    let queryRef = collectionRef;
    if (before) queryRef = queryRef.where('updatedAt', '<', before);
    snapshot = await queryRef.orderBy('updatedAt', 'desc').limit(requestedLimit + 1).get();
  }

  const hasMore = !incremental && snapshot.docs.length > requestedLimit;
  const pageDocs = hasMore ? snapshot.docs.slice(0, requestedLimit) : snapshot.docs;
  const notifications = pageDocs
    .map(serializeProfessionalNotification)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));

  const cursor = notifications.reduce((latest, notification) => {
    const candidate = notification.updatedAt || notification.createdAt;
    return candidate && (!latest || candidate > latest) ? candidate : latest;
  }, updatedAfter ? updatedAfter.toISOString() : null);
  const nextPageCursor = notifications.length > 0
    ? (notifications[notifications.length - 1].updatedAt || notifications[notifications.length - 1].createdAt)
    : null;

  return {
    notifications,
    cursor,
    nextPageCursor,
    incremental,
    hasMore,
  };
}

function normalizeProfessionalNotificationIds(values) {
  return Array.isArray(values)
    ? [...new Set(values.map(value => normalizeText(value, 128)).filter(value => /^[a-zA-Z0-9_-]{1,128}$/.test(value)))].slice(0, PROFESSIONAL_NOTIFICATION_BULK_LIMIT)
    : [];
}

async function resolveProfessionalNotificationSnapshots(db, ownerUserId, body) {
  const ids = normalizeProfessionalNotificationIds(body.notificationIds);
  if (ids.length > 0) {
    const refs = ids.map(id => db.doc(`users/${ownerUserId}/portalNotifications/${id}`));
    return db.getAll(...refs);
  }

  const scope = normalizeText(body.scope, 40);
  const collectionRef = db.collection(`users/${ownerUserId}/portalNotifications`);
  let queryRef;
  if (scope === 'all_unread') queryRef = collectionRef.where('read', '==', false);
  else if (scope === 'read_informational' || scope === 'all_read') queryRef = collectionRef.where('read', '==', true);
  else if (scope === 'archived_deletable') queryRef = collectionRef.where('archived', '==', true);
  else return [];
  const snapshot = await queryRef.limit(PROFESSIONAL_NOTIFICATION_BULK_LIMIT + 1).get();
  return snapshot.docs;
}

async function manageProfessionalNotifications(db, decodedToken, body) {
  const { ownerUserId } = await requireInternalNotificationContext(db, decodedToken);
  const operation = normalizeText(body.operation, 32);
  if (!['mark_read', 'mark_unread', 'complete', 'archive', 'ignore', 'delete'].includes(operation)) {
    throw accessError('access/invalid-notification-operation', 'A ação de notificação informada é inválida.');
  }
  const scope = normalizeText(body.scope, 40);
  const snapshots = await resolveProfessionalNotificationSnapshots(db, ownerUserId, body);
  const hasMore = snapshots.length > PROFESSIONAL_NOTIFICATION_BULK_LIMIT;
  const selected = hasMore ? snapshots.slice(0, PROFESSIONAL_NOTIFICATION_BULK_LIMIT) : snapshots;
  const batch = db.batch();
  const affectedIds = [];
  const deletedIds = [];
  const skippedIds = [];

  for (const snapshot of selected) {
    if (!snapshot.exists) continue;
    const data = snapshot.data();
    const lifecycle = notificationLifecycleForData(data);
    const type = normalizeText(data.type, 80);
    const isPendingProfileReview = type === 'patient_profile_update'
      && data.requestVersion === 2
      && data.reviewStatus === 'pending';
    if (isPendingProfileReview && ['complete', 'archive', 'ignore', 'delete'].includes(operation)) {
      skippedIds.push(snapshot.id);
      continue;
    }
    if (scope === 'read_informational' && !['portal_access', 'gallery_access'].includes(type)) continue;
    if (scope === 'archived_deletable' && (!lifecycle.archived || lifecycle.protectedFromDeletion)) continue;

    if (operation === 'delete') {
      if (!lifecycle.archived || lifecycle.protectedFromDeletion) {
        skippedIds.push(snapshot.id);
        continue;
      }
      batch.delete(snapshot.ref);
      deletedIds.push(snapshot.id);
      continue;
    }

    if ((operation === 'archive' || operation === 'ignore') && lifecycle.pendingAction && !lifecycle.completed) {
      skippedIds.push(snapshot.id);
      continue;
    }
    if (operation === 'complete' && !lifecycle.pendingAction) {
      skippedIds.push(snapshot.id);
      continue;
    }

    const update = { updatedAt: FieldValue.serverTimestamp() };
    if (operation === 'mark_read') {
      update.read = true;
      update.readAt = FieldValue.serverTimestamp();
    } else if (operation === 'mark_unread') {
      update.read = false;
      update.readAt = null;
    } else if (operation === 'complete') {
      update.read = true;
      update.readAt = FieldValue.serverTimestamp();
      update.pendingAction = false;
      update.completed = true;
      update.completedAt = FieldValue.serverTimestamp();
      update.status = 'completed';
    } else if (operation === 'archive') {
      update.read = true;
      update.readAt = FieldValue.serverTimestamp();
      update.archived = true;
      update.archivedAt = FieldValue.serverTimestamp();
      update.status = 'archived';
    } else if (operation === 'ignore') {
      update.read = true;
      update.readAt = FieldValue.serverTimestamp();
      update.archived = true;
      update.archivedAt = FieldValue.serverTimestamp();
      update.ignored = true;
      update.status = 'ignored';
    }
    batch.set(snapshot.ref, update, { merge: true });
    affectedIds.push(snapshot.id);
  }

  if (affectedIds.length > 0 || deletedIds.length > 0) await batch.commit();
  return {
    updated: affectedIds.length,
    deleted: deletedIds.length,
    affectedIds,
    deletedIds,
    skippedIds,
    hasMore,
  };
}

async function markProfessionalNotificationsRead(db, decodedToken, body) {
  return manageProfessionalNotifications(db, decodedToken, {
    operation: 'mark_read',
    notificationIds: body.notificationIds,
  });
}

async function requireResponsibleContext(db, decodedToken) {
  const profileSnapshot = await getProfile(db, decodedToken);
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  if (!profile || profile.status !== 'approved' || profile.role !== 'responsible') {
    throw accessError(
      'access/responsible-approved-required',
      'Favor entrar em contato com a clínica responsável.',
      403,
    );
  }
  return {
    profile,
    linkedPatientIds: serializeLinkedPatientIds(profile.linkedPatientIds),
    ownerUserId: await getPrimaryAdminUid(),
  };
}

async function getResponsiblePortalData(db, decodedToken, req) {
  const { profile, linkedPatientIds, ownerUserId } = await requireResponsibleContext(db, decodedToken);
  const settingsSnapshot = await db.doc(`users/${ownerUserId}/settings/config`).get();
  const settings = serializePortalSettings(settingsSnapshot.exists ? settingsSnapshot.data() : {});
  const baseResult = {
    responsible: {
      uid: decodedToken.uid,
      displayName: normalizeText(profile.displayName || decodedToken.name, 120),
      email: normalizeEmail(profile.email || decodedToken.email),
    },
    settings,
    patients: [],
  };
  if (linkedPatientIds.length === 0) return baseResult;

  const today = new Date().toISOString().slice(0, 10);
  const patientResults = [];

  for (const patientId of linkedPatientIds) {
    const patientRef = db.doc(`users/${ownerUserId}/patients/${patientId}`);
    const patientSnapshot = await patientRef.get();
    if (!patientSnapshot.exists) continue;
    const patient = patientSnapshot.data();

    const [sessionsSnapshot, paymentsSnapshot, documentsSnapshot] = await Promise.all([
      db.collection(`users/${ownerUserId}/sessions`).where('patientId', '==', patientId).limit(500).get(),
      db.collection(`users/${ownerUserId}/payments`).where('patientId', '==', patientId).limit(200).get(),
      patientRef.collection('portalDocuments').limit(100).get(),
    ]);

    const sessions = sessionsSnapshot.docs
      .map(serializeResponsibleSession)
      .filter(session => session.patientId === patientId && /^\d{4}-\d{2}-\d{2}$/.test(session.date));
    const packageResult = buildResponsiblePackages(sessions, { today });
    const payments = paymentsSnapshot.docs.map(serializeResponsiblePayment);
    for (const pkg of packageResult.packages) {
      Object.assign(pkg, getPackagePaymentSummary(payments, pkg.number));
    }

    const media = [];

    const documents = documentsSnapshot.docs
      .map(serializeResponsibleDocument)
      .filter(document => document.status === 'available')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    const latestProfileChangeRequest = serializeLatestProfileChangeRequestSummary(
      profile.latestPatientProfileRequests && typeof profile.latestPatientProfileRequests === 'object'
        ? profile.latestPatientProfileRequests[patientId]
        : null,
    );

    patientResults.push({
      patient: serializeResponsiblePatientProfile(patientId, patient),
      currentPackageNumber: packageResult.currentPackageNumber,
      packages: packageResult.packages,
      media,
      documents,
      latestProfileChangeRequest,
    });
  }

  const responsibleName = normalizeText(profile.displayName || decodedToken.name, 120) || 'Responsável';
  const responsibleEmail = normalizeEmail(profile.email || decodedToken.email);
  const patientNames = patientResults.map(item => normalizeText(item.patient?.name, 120)).filter(Boolean);
  const accessMessage = patientNames.length === 1
    ? `${responsibleName} entrou no Portal do Responsável de ${patientNames[0]}.`
    : `${responsibleName} entrou no Portal do Responsável.`;
  const portalSessionId = normalizeText(req?.query?.portalSessionId, 128);
  const notificationId = crypto.createHash('sha256')
    .update(`${decodedToken.uid}:last-portal-access`)
    .digest('hex');
  const notificationRef = db.doc(`users/${ownerUserId}/portalNotifications/${notificationId}`);
  const clientContext = inferRequestClientContext(req, {
    portalTab: 'dashboard',
    actionLocation: 'Portal do Responsável / Entrada',
  });
  const details = [
    notificationDetail('Ação', 'Último acesso autenticado ao Portal do Responsável'),
    notificationDetail('Responsável', responsibleName),
    notificationDetail('E-mail da conta', responsibleEmail),
    notificationDetail('Atendente(s) disponível(is)', patientNames.join(', ') || 'Nenhum atendente vinculado'),
    notificationDetail('Dispositivo', clientContext.deviceType),
    notificationDetail('Navegador', clientContext.browser),
    notificationDetail('Sistema', clientContext.platform),
  ];
  const existingAccess = await notificationRef.get();
  const existingAccessData = existingAccess.exists ? existingAccess.data() : null;
  const samePortalSession = Boolean(
    portalSessionId
    && existingAccessData
    && normalizeText(existingAccessData.portalSessionId, 128) === portalSessionId
  );
  if (!samePortalSession) {
    await notificationRef.set({
      id: notificationRef.id,
      type: 'portal_access',
      ...notificationBaseFields('portal_access'),
      portalSessionId: portalSessionId || null,
      title: 'Último acesso do responsável',
      message: accessMessage,
      patientId: patientResults[0]?.patient?.id || '',
      patientName: patientResults[0]?.patient?.name || '',
      responsibleUid: decodedToken.uid,
      responsibleName,
      responsibleEmail,
      actionLocation: clientContext.actionLocation,
      actionTarget: patientNames.join(', '),
      navigationTarget: 'patient_profile',
      clientContext,
      details,
      read: false,
      readAt: null,
      lastAccessAt: FieldValue.serverTimestamp(),
      createdAt: existingAccessData?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return { ...baseResult, patients: patientResults };
}


async function listAdminResponsiblePreviewOptions(db, patientId) {
  const snapshot = await db.collection('accessProfiles')
    .where('linkedPatientIds', 'array-contains', patientId)
    .limit(100)
    .get();

  return snapshot.docs
    .map(document => {
      const profile = document.data() || {};
      return {
        uid: document.id,
        displayName: normalizeText(profile.displayName, 120) || 'Responsável',
        email: normalizeEmail(profile.email),
        status: normalizeText(profile.status, 40),
        role: normalizeText(profile.role, 40),
        profile,
      };
    })
    .filter(option => option.status === 'approved' && option.role === 'responsible')
    .sort((left, right) => (
      left.displayName.localeCompare(right.displayName, 'pt-BR')
      || left.email.localeCompare(right.email, 'pt-BR')
    ));
}

async function getAdminResponsiblePortalData(db, decodedToken, req) {
  requirePrimaryAdmin(decodedToken);

  const patientId = normalizeText(req?.query?.patientId, 128);
  if (!patientId) {
    throw accessError(
      'access/admin-preview-patient-required',
      'Não foi possível identificar o atendente para a visualização.',
      400,
    );
  }

  const ownerUserId = await getPrimaryAdminUid();
  const patientRef = db.doc(`users/${ownerUserId}/patients/${patientId}`);
  const [patientSnapshot, settingsSnapshot, responsibleOptions] = await Promise.all([
    patientRef.get(),
    db.doc(`users/${ownerUserId}/settings/config`).get(),
    listAdminResponsiblePreviewOptions(db, patientId),
  ]);

  if (!patientSnapshot.exists) {
    throw accessError('access/patient-not-found', 'Atendente não encontrado.', 404);
  }

  const patient = patientSnapshot.data();
  const requestedResponsibleUid = normalizeText(req?.query?.responsibleUid, 128);
  const selectedResponsible = responsibleOptions.find(option => option.uid === requestedResponsibleUid)
    || responsibleOptions[0]
    || null;
  const selectedResponsibleUid = selectedResponsible?.uid || '';
  const selectedProfile = selectedResponsible?.profile || null;
  const settings = serializePortalSettings(settingsSnapshot.exists ? settingsSnapshot.data() : {});
  const today = new Date().toISOString().slice(0, 10);

  const [sessionsSnapshot, paymentsSnapshot, documentsSnapshot] = await Promise.all([
    db.collection(`users/${ownerUserId}/sessions`).where('patientId', '==', patientId).limit(500).get(),
    db.collection(`users/${ownerUserId}/payments`).where('patientId', '==', patientId).limit(200).get(),
    patientRef.collection('portalDocuments').limit(100).get(),
  ]);

  const sessions = sessionsSnapshot.docs
    .map(serializeResponsibleSession)
    .filter(session => session.patientId === patientId && /^\d{4}-\d{2}-\d{2}$/.test(session.date));
  const packageResult = buildResponsiblePackages(sessions, { today });
  const payments = paymentsSnapshot.docs.map(serializeResponsiblePayment);
  for (const pkg of packageResult.packages) {
    Object.assign(pkg, getPackagePaymentSummary(payments, pkg.number));
  }

  const media = [];

  const documents = documentsSnapshot.docs
    .map(serializeResponsibleDocument)
    .filter(document => document.status === 'available')
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));

  const latestProfileChangeRequest = serializeLatestProfileChangeRequestSummary(
    selectedProfile?.latestPatientProfileRequests
      && typeof selectedProfile.latestPatientProfileRequests === 'object'
      ? selectedProfile.latestPatientProfileRequests[patientId]
      : null,
  );

  const patientResult = {
    patient: serializeResponsiblePatientProfile(patientId, patient),
    currentPackageNumber: packageResult.currentPackageNumber,
    packages: packageResult.packages,
    media,
    documents,
    latestProfileChangeRequest,
  };

  const fallbackResponsibleName = normalizeText(patient.guardianName, 120) || 'Responsável';
  const responsibleName = selectedResponsible?.displayName || fallbackResponsibleName;
  const responsibleEmail = selectedResponsible?.email || '';

  return {
    responsible: {
      uid: selectedResponsibleUid || `admin-preview:${patientId}`,
      displayName: responsibleName,
      email: responsibleEmail,
    },
    settings,
    patients: [patientResult],
    adminPreview: {
      readOnly: true,
      patientId,
      selectedResponsibleUid,
      hasLinkedResponsible: responsibleOptions.length > 0,
      responsibleOptions: responsibleOptions.map(option => ({
        uid: option.uid,
        displayName: option.displayName,
        email: option.email,
      })),
    },
  };
}

function patientPhotoFileId(patient = {}) {
  const direct = normalizeText(patient.photoDriveFileId, 256);
  if (direct) return direct;
  const storagePath = normalizeText(patient.photoStoragePath, 320);
  return storagePath.startsWith('google-drive:') ? storagePath.slice('google-drive:'.length) : '';
}

async function getResponsiblePatientPhotoUrl(db, decodedToken, body, req) {
  const { linkedPatientIds, ownerUserId } = await requireResponsibleContext(db, decodedToken);
  const patientId = normalizeText(body.patientId, 128);
  if (!patientId || !linkedPatientIds.includes(patientId)) {
    throw accessError('access/patient-not-linked', 'O atendente informado não está vinculado a este acesso.', 403);
  }
  const patientSnapshot = await db.doc(`users/${ownerUserId}/patients/${patientId}`).get();
  if (!patientSnapshot.exists) throw accessError('access/patient-not-found', 'Atendente não encontrado.', 404);
  const patient = patientSnapshot.data();
  const fileId = patientPhotoFileId(patient);
  if (fileId) {
    const metadata = await getDriveFileMetadata(fileId);
    assertOwnedPatientPhoto(metadata, ownerUserId);
    return createSignedPhotoUrl({ req, fileId, ownerUserId });
  }
  const legacyUrl = typeof patient.photoUrl === 'string' ? patient.photoUrl.trim() : '';
  if (legacyUrl) return { url: legacyUrl, expiresAt: Date.now() + 5 * 60 * 1000 };
  return { url: '', expiresAt: 0 };
}


async function getAdminResponsiblePatientPhotoUrl(db, decodedToken, body, req) {
  requirePrimaryAdmin(decodedToken);

  const ownerUserId = await getPrimaryAdminUid();
  const patientId = normalizeText(body.patientId, 128);
  if (!patientId) {
    throw accessError('access/admin-preview-patient-required', 'Não foi possível identificar o atendente.', 400);
  }

  const patientSnapshot = await db.doc(`users/${ownerUserId}/patients/${patientId}`).get();
  if (!patientSnapshot.exists) {
    throw accessError('access/patient-not-found', 'Atendente não encontrado.', 404);
  }

  const patient = patientSnapshot.data();
  const fileId = patientPhotoFileId(patient);
  if (fileId) {
    const metadata = await getDriveFileMetadata(fileId);
    assertOwnedPatientPhoto(metadata, ownerUserId);
    return createSignedPhotoUrl({ req, fileId, ownerUserId });
  }

  const legacyUrl = typeof patient.photoUrl === 'string' ? patient.photoUrl.trim() : '';
  if (legacyUrl) return { url: legacyUrl, expiresAt: Date.now() + 5 * 60 * 1000 };
  return { url: '', expiresAt: 0 };
}

const RESPONSIBLE_PATIENT_TEXT_FIELDS = {
  name: 120,
  fullName: 180,
  birthDate: 10,
  guardianName: 120,
  whatsapp: 30,
  motherName: 180,
  motherProfession: 120,
  motherPhone: 30,
  fatherName: 180,
  fatherProfession: 120,
  fatherPhone: 30,
  otherResponsibleName: 180,
  otherResponsibleKinship: 100,
  otherResponsiblePhone: 30,
  school: 180,
  grade: 100,
  educationDetail: 180,
  shift: 40,
  custodyResponsibleName: 180,
  custodyResponsibleKinship: 100,
  doctorName: 180,
  medication: 1000,
  emergencyContact: 300,
  allergies: 1000,
  financialResponsibleOtherName: 180,
  financialResponsibleOtherKinship: 100,
  financialResponsibleOtherPhone: 30,
  financialResponsibleOtherCpf: 20,
};

const RESPONSIBLE_PATIENT_ENUM_FIELDS = {
  sex: new Set(['Masculino', 'Feminino', 'Não informado']),
  familyStatus: new Set([
    'Casados',
    'União estável',
    'Separados',
    'Divorciados',
    'Nunca viveram juntos',
    'Pai falecido',
    'Mãe falecida',
    'Ambos falecidos',
  ]),
  custodyStatus: new Set([
    'Guarda compartilhada',
    'Guarda unilateral da mãe',
    'Guarda unilateral do pai',
    'Guarda de outro responsável',
  ]),
  financialResponsible: new Set(['Pai', 'Mãe', 'Outro']),
};

const RESPONSIBLE_PATIENT_FIELD_LABELS = {
  name: '1º Nome do Atendente',
  fullName: 'Nome completo do Atendente',
  birthDate: 'Data de nascimento',
  sex: 'Sexo',
  guardianName: '1º Nome do Responsável',
  whatsapp: 'WhatsApp do Responsável',
  motherName: 'Nome completo da mãe',
  motherProfession: 'Profissão da mãe',
  motherPhone: 'Contato da mãe',
  fatherName: 'Nome completo do pai',
  fatherProfession: 'Profissão do pai',
  fatherPhone: 'Contato do pai',
  otherResponsibleName: 'Nome completo de outro responsável',
  otherResponsibleKinship: 'Parentesco do outro responsável',
  otherResponsiblePhone: 'Contato de outro responsável',
  school: 'Escola',
  grade: 'Ano/nível escolar',
  educationDetail: 'Curso, especialização ou formação',
  shift: 'Turno',
  familyStatus: 'Situação familiar',
  custodyStatus: 'Situação da guarda',
  custodyResponsibleName: 'Nome do responsável pela guarda',
  custodyResponsibleKinship: 'Parentesco do responsável pela guarda',
  careProfessionals: 'Profissionais que acompanham o Atendente',
  doctorName: 'Profissional/médico informado anteriormente',
  medication: 'Medicação em uso',
  emergencyContact: 'Contato de emergência',
  allergies: 'Alergias e restrições',
  financialResponsible: 'Responsável financeiro',
  financialResponsibleOtherName: 'Nome do responsável financeiro',
  financialResponsibleOtherKinship: 'Parentesco do responsável financeiro',
  financialResponsibleOtherPhone: 'Telefone do responsável financeiro',
  financialResponsibleOtherCpf: 'CPF do responsável financeiro',
};

function normalizePatientCareProfessionals(value) {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set();
  return value.slice(0, 20).map((item, index) => {
    const source = item && typeof item === 'object' ? item : {};
    let id = normalizeText(source.id, 128) || `care-${index + 1}`;
    if (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    return {
      id,
      specialty: normalizeText(source.specialty, 100),
      customSpecialty: normalizeText(source.customSpecialty, 100),
      name: normalizeText(source.name, 180),
      contact: normalizeText(source.contact, 120),
    };
  }).filter(item => item.specialty);
}

function normalizeResponsiblePatientField(field, value) {
  if (field === 'careProfessionals') return normalizePatientCareProfessionals(value);
  if (Object.prototype.hasOwnProperty.call(RESPONSIBLE_PATIENT_TEXT_FIELDS, field)) {
    return normalizeText(value, RESPONSIBLE_PATIENT_TEXT_FIELDS[field]);
  }
  const allowed = RESPONSIBLE_PATIENT_ENUM_FIELDS[field];
  if (allowed) {
    const normalized = normalizeText(value, 100);
    return allowed.has(normalized) ? normalized : '';
  }
  return undefined;
}

function patientFieldValuesEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function serializeResponsiblePatientProfile(patientId, patient = {}) {
  return {
    id: patientId,
    name: normalizeText(patient.name, 120) || 'Paciente',
    firstName: normalizeText(patient.name, 120).split(' ')[0] || 'Paciente',
    fullName: normalizeText(patient.fullName, 180) || normalizeText(patient.name, 120),
    birthDate: normalizeText(patient.birthDate, 10),
    sex: RESPONSIBLE_PATIENT_ENUM_FIELDS.sex.has(patient.sex) ? patient.sex : 'Não informado',
    guardianName: normalizeText(patient.guardianName, 120),
    whatsapp: normalizeText(patient.whatsapp, 30),
    motherName: normalizeText(patient.motherName, 180),
    motherProfession: normalizeText(patient.motherProfession, 120),
    motherPhone: normalizeText(patient.motherPhone, 30),
    fatherName: normalizeText(patient.fatherName, 180),
    fatherProfession: normalizeText(patient.fatherProfession, 120),
    fatherPhone: normalizeText(patient.fatherPhone, 30),
    otherResponsibleName: normalizeText(patient.otherResponsibleName, 180),
    otherResponsibleKinship: normalizeText(patient.otherResponsibleKinship, 100),
    otherResponsiblePhone: normalizeText(patient.otherResponsiblePhone, 30),
    school: normalizeText(patient.school, 180),
    grade: normalizeText(patient.grade, 100),
    educationDetail: normalizeText(patient.educationDetail, 180),
    shift: normalizeText(patient.shift, 40),
    familyStatus: RESPONSIBLE_PATIENT_ENUM_FIELDS.familyStatus.has(patient.familyStatus) ? patient.familyStatus : undefined,
    custodyStatus: RESPONSIBLE_PATIENT_ENUM_FIELDS.custodyStatus.has(patient.custodyStatus) ? patient.custodyStatus : undefined,
    custodyResponsibleName: normalizeText(patient.custodyResponsibleName, 180),
    custodyResponsibleKinship: normalizeText(patient.custodyResponsibleKinship, 100),
    careProfessionals: normalizePatientCareProfessionals(patient.careProfessionals),
    doctorName: normalizeText(patient.doctorName, 180),
    medication: normalizeText(patient.medication, 1000),
    emergencyContact: normalizeText(patient.emergencyContact, 300),
    allergies: normalizeText(patient.allergies, 1000),
    financialResponsible: RESPONSIBLE_PATIENT_ENUM_FIELDS.financialResponsible.has(patient.financialResponsible)
      ? patient.financialResponsible
      : undefined,
    financialResponsibleOtherName: normalizeText(patient.financialResponsibleOtherName, 180),
    financialResponsibleOtherKinship: normalizeText(patient.financialResponsibleOtherKinship, 100),
    financialResponsibleOtherPhone: normalizeText(patient.financialResponsibleOtherPhone, 30),
    financialResponsibleOtherCpf: normalizeText(patient.financialResponsibleOtherCpf, 20),
    hasPhoto: Boolean(
      patient.photoDriveFileId
      || String(patient.photoStoragePath || '').startsWith('google-drive:')
      || patient.photoUrl
    ),
  };
}

function serializePatientProfileChangeRequest(snapshot) {
  if (!snapshot?.exists) return null;
  const data = snapshot.data() || {};
  const status = ['pending', 'approved', 'rejected'].includes(data.reviewStatus)
    ? data.reviewStatus
    : 'pending';
  return {
    id: snapshot.id,
    patientId: normalizeText(data.patientId, 128),
    patientName: normalizeText(data.patientName, 180),
    responsibleUid: normalizeText(data.responsibleUid, 128),
    responsibleName: normalizeText(data.responsibleName, 120),
    responsibleEmail: normalizeEmail(data.responsibleEmail),
    status,
    changedFields: Array.isArray(data.changedFields)
      ? data.changedFields.map(field => normalizeText(field, 100)).filter(Boolean)
      : [],
    before: data.before && typeof data.before === 'object' ? data.before : {},
    after: data.after && typeof data.after === 'object' ? data.after : {},
    createdAt: serializeDate(data.createdAt),
    reviewedAt: serializeDate(data.reviewedAt),
    reviewedBy: data.reviewedBy ? String(data.reviewedBy) : null,
    reviewedByEmail: data.reviewedByEmail ? normalizeEmail(data.reviewedByEmail) : null,
    rejectionReason: data.rejectionReason ? normalizeText(data.rejectionReason, 1000) : null,
  };
}

function serializeLatestProfileChangeRequestSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const status = ['pending', 'approved', 'rejected'].includes(value.status) ? value.status : null;
  const id = normalizeText(value.id, 128);
  if (!id || !status) return null;
  return {
    id,
    status,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : serializeDate(value.createdAt),
    reviewedAt: typeof value.reviewedAt === 'string' ? value.reviewedAt : serializeDate(value.reviewedAt),
  };
}

async function requestResponsiblePatientUpdate(db, decodedToken, body) {
  const { profile, linkedPatientIds, ownerUserId } = await requireResponsibleContext(db, decodedToken);
  const patientId = normalizeText(body.patientId, 128);
  if (!patientId || !linkedPatientIds.includes(patientId)) {
    throw accessError('access/patient-not-linked', 'O atendente informado não está vinculado a este acesso.', 403);
  }
  if (body.declarationAccepted !== true) {
    throw accessError(
      'access/profile-declaration-required',
      'Confirme a declaração de ciência antes de enviar a solicitação.',
      400,
    );
  }

  const patientRef = db.doc(`users/${ownerUserId}/patients/${patientId}`);
  const patientSnapshot = await patientRef.get();
  if (!patientSnapshot.exists) throw accessError('access/patient-not-found', 'Atendente não encontrado.', 404);
  const current = patientSnapshot.data();
  const rawValues = body.values && typeof body.values === 'object' ? body.values : {};
  const before = {};
  const after = {};
  const changedFields = [];
  const supportedFields = [
    ...Object.keys(RESPONSIBLE_PATIENT_TEXT_FIELDS),
    ...Object.keys(RESPONSIBLE_PATIENT_ENUM_FIELDS),
    'careProfessionals',
  ];

  for (const field of supportedFields) {
    if (!Object.prototype.hasOwnProperty.call(rawValues, field)) continue;
    const next = normalizeResponsiblePatientField(field, rawValues[field]);
    const previous = normalizeResponsiblePatientField(field, current[field]);
    if (field === 'name' && !next) {
      throw accessError('access/patient-name-required', 'Informe o 1º nome do atendente.');
    }
    if (!patientFieldValuesEqual(next, previous)) {
      before[field] = previous;
      after[field] = next;
      changedFields.push(field);
    }
  }

  const requiredProfileFields = [
    ['name', 'Informe o 1º nome do atendente.'],
    ['fullName', 'Informe o nome completo do atendente.'],
    ['birthDate', 'Informe a data de nascimento do atendente.'],
    ['guardianName', 'Informe o 1º nome do responsável.'],
    ['whatsapp', 'Informe o WhatsApp do responsável.'],
  ];
  for (const [field, message] of requiredProfileFields) {
    const effectiveValue = Object.prototype.hasOwnProperty.call(after, field)
      ? after[field]
      : normalizeResponsiblePatientField(field, current[field]);
    if (!normalizeText(effectiveValue, 300)) {
      throw accessError(`access/patient-${field}-required`, message);
    }
  }

  if (changedFields.length === 0) {
    return {
      submitted: false,
      existingPending: false,
      patient: serializeResponsiblePatientProfile(patientId, current),
      changedFields: [],
      request: null,
    };
  }

  const latestByPatient = profile.latestPatientProfileRequests && typeof profile.latestPatientProfileRequests === 'object'
    ? profile.latestPatientProfileRequests
    : {};
  const latestSummary = serializeLatestProfileChangeRequestSummary(latestByPatient[patientId]);
  if (latestSummary?.status === 'pending') {
    const existingRef = db.doc(`users/${ownerUserId}/portalNotifications/${latestSummary.id}`);
    const existingSnapshot = await existingRef.get();
    if (existingSnapshot.exists && existingSnapshot.data()?.reviewStatus === 'pending') {
      return {
        submitted: false,
        existingPending: true,
        patient: serializeResponsiblePatientProfile(patientId, current),
        changedFields: serializePatientProfileChangeRequest(existingSnapshot)?.changedFields || [],
        request: serializePatientProfileChangeRequest(existingSnapshot),
      };
    }
  }

  const responsibleName = normalizeText(profile.displayName || decodedToken.name, 120) || 'Responsável';
  const responsibleEmail = normalizeEmail(profile.email || decodedToken.email);
  const clientContext = normalizeClientContext({
    portalTab: 'profile',
    actionLocation: 'Portal do Responsável / Solicitação de alteração cadastral',
    ...(body.clientContext && typeof body.clientContext === 'object' ? body.clientContext : {}),
  });
  const patientName = normalizeText(after.fullName || current.fullName || after.name || current.name, 180) || 'Atendente';
  const formatChangeValue = (field, value) => {
    if (field !== 'careProfessionals') return value;
    return normalizePatientCareProfessionals(value).map(item => {
      const specialty = item.specialty === 'Outro'
        ? item.customSpecialty || 'Outro'
        : item.specialty;
      const details = [item.name, item.contact].filter(Boolean).join(' — ');
      return details ? `${specialty}: ${details}` : specialty;
    }).join('; ');
  };
  const changeDetails = changedFields.map(field => notificationDetail(
    RESPONSIBLE_PATIENT_FIELD_LABELS[field] || field,
    'Alteração aguardando aprovação',
    {
      previousValue: formatChangeValue(field, before[field]),
      newValue: formatChangeValue(field, after[field]),
    },
  ));
  const notificationRef = db.collection(`users/${ownerUserId}/portalNotifications`).doc();
  const profileRef = db.collection('accessProfiles').doc(decodedToken.uid);
  const createdAtIso = new Date().toISOString();

  const transactionResult = await db.runTransaction(async transaction => {
    const freshProfileSnapshot = await transaction.get(profileRef);
    const freshProfile = freshProfileSnapshot.exists ? freshProfileSnapshot.data() : {};
    const freshLatestMap = freshProfile.latestPatientProfileRequests
      && typeof freshProfile.latestPatientProfileRequests === 'object'
      ? freshProfile.latestPatientProfileRequests
      : {};
    const freshLatestSummary = serializeLatestProfileChangeRequestSummary(freshLatestMap[patientId]);

    if (freshLatestSummary?.status === 'pending') {
      const existingRef = db.doc(`users/${ownerUserId}/portalNotifications/${freshLatestSummary.id}`);
      const existingSnapshot = await transaction.get(existingRef);
      if (existingSnapshot.exists && existingSnapshot.data()?.reviewStatus === 'pending') {
        return {
          existingRequest: serializePatientProfileChangeRequest(existingSnapshot),
        };
      }
    }

    const nextLatestMap = {
      ...freshLatestMap,
      [patientId]: {
        id: notificationRef.id,
        status: 'pending',
        createdAt: createdAtIso,
        reviewedAt: null,
      },
    };

    transaction.set(notificationRef, {
      type: 'patient_profile_update',
      requestVersion: 2,
      reviewStatus: 'pending',
      ...notificationBaseFields('patient_profile_update', { changedFields }),
      title: 'Alteração cadastral aguardando aprovação',
      message: `${responsibleName} solicitou alteração de ${changedFields.length} campo(s) do cadastro de ${patientName}.`,
      patientId,
      patientName,
      responsibleUid: decodedToken.uid,
      responsibleName,
      responsibleEmail,
      changedFields,
      before,
      after,
      declarationAccepted: true,
      declarationText: 'Declaro que as informações fornecidas são verdadeiras e não substituem orientação ou prescrição médica.',
      declarationAcceptedAt: FieldValue.serverTimestamp(),
      actionLocation: clientContext.actionLocation,
      actionTarget: `Cadastro de ${patientName}`,
      navigationTarget: 'patient_profile',
      clientContext,
      details: changeDetails,
      pendingAction: true,
      completed: false,
      status: 'pending',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(profileRef, { latestPatientProfileRequests: nextLatestMap }, { merge: true });
    return { existingRequest: null };
  });

  if (transactionResult.existingRequest) {
    return {
      submitted: false,
      existingPending: true,
      patient: serializeResponsiblePatientProfile(patientId, current),
      changedFields: transactionResult.existingRequest.changedFields || [],
      request: transactionResult.existingRequest,
    };
  }

  const createdSnapshot = await notificationRef.get();
  return {
    submitted: true,
    existingPending: false,
    patient: serializeResponsiblePatientProfile(patientId, current),
    changedFields,
    request: serializePatientProfileChangeRequest(createdSnapshot),
  };
}

async function listPatientProfileChangeRequests(db, decodedToken, req) {
  const { ownerUserId } = await requireInternalNotificationContext(db, decodedToken);
  const patientId = normalizeText(req?.query?.patientId, 128);
  if (!patientId) throw accessError('access/patient-id-required', 'Informe o atendente para consultar as solicitações.');
  const snapshot = await db.collection(`users/${ownerUserId}/portalNotifications`)
    .where('patientId', '==', patientId)
    .limit(100)
    .get();
  const requests = snapshot.docs
    .filter(item => item.data()?.type === 'patient_profile_update' && item.data()?.requestVersion === 2)
    .map(serializePatientProfileChangeRequest)
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { requests };
}

async function reviewPatientProfileChangeRequest(db, decodedToken, body) {
  const { ownerUserId } = await requireInternalNotificationContext(db, decodedToken);
  const requestId = normalizeText(body.requestId, 128);
  const decision = normalizeText(body.decision, 20);
  const rejectionReason = normalizeText(body.rejectionReason, 1000);
  if (!requestId) throw accessError('access/profile-request-id-required', 'Solicitação não informada.');
  if (!['approved', 'rejected'].includes(decision)) {
    throw accessError('access/profile-request-invalid-decision', 'Selecione aprovar ou recusar.');
  }

  const requestRef = db.doc(`users/${ownerUserId}/portalNotifications/${requestId}`);
  await db.runTransaction(async transaction => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) throw accessError('access/profile-request-not-found', 'Solicitação não encontrada.', 404);
    const requestData = requestSnapshot.data();
    if (requestData.type !== 'patient_profile_update' || requestData.requestVersion !== 2) {
      throw accessError('access/profile-request-invalid', 'O registro informado não é uma solicitação cadastral válida.');
    }
    if (requestData.reviewStatus !== 'pending') {
      throw accessError('access/profile-request-already-reviewed', 'Esta solicitação já foi analisada.', 409);
    }

    const patientId = normalizeText(requestData.patientId, 128);
    const patientRef = db.doc(`users/${ownerUserId}/patients/${patientId}`);
    const patientSnapshot = await transaction.get(patientRef);
    if (!patientSnapshot.exists) throw accessError('access/patient-not-found', 'Atendente não encontrado.', 404);

    const responsibleUid = normalizeText(requestData.responsibleUid, 128);
    const responsibleProfileRef = responsibleUid
      ? db.collection('accessProfiles').doc(responsibleUid)
      : null;
    const responsibleProfileSnapshot = responsibleProfileRef
      ? await transaction.get(responsibleProfileRef)
      : null;

    const current = patientSnapshot.data();
    const changedFields = Array.isArray(requestData.changedFields) ? requestData.changedFields : [];
    const before = requestData.before && typeof requestData.before === 'object' ? requestData.before : {};
    const after = requestData.after && typeof requestData.after === 'object' ? requestData.after : {};
    const patientPatch = {};

    if (decision === 'approved') {
      const conflicts = [];
      for (const field of changedFields) {
        const currentValue = normalizeResponsiblePatientField(field, current[field]);
        const beforeValue = normalizeResponsiblePatientField(field, before[field]);
        if (!patientFieldValuesEqual(currentValue, beforeValue)) {
          conflicts.push(RESPONSIBLE_PATIENT_FIELD_LABELS[field] || field);
          continue;
        }
        patientPatch[field] = normalizeResponsiblePatientField(field, after[field]);
      }
      if (conflicts.length > 0) {
        throw accessError(
          'access/profile-request-conflict',
          `O cadastro foi alterado após a solicitação nos campos: ${conflicts.join(', ')}. Recuse esta solicitação e confira os dados atuais.`,
          409,
        );
      }
    }

    if (decision === 'approved') {
      transaction.set(patientRef, {
        ...patientPatch,
        lastResponsiblePortalApprovedUpdate: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const reviewedBy = decodedToken.uid;
    const reviewedByEmail = normalizeEmail(decodedToken.email);
    transaction.set(requestRef, {
      reviewStatus: decision,
      rejectionReason: decision === 'rejected' ? rejectionReason : null,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy,
      reviewedByEmail,
      pendingAction: false,
      completed: true,
      completedAt: FieldValue.serverTimestamp(),
      status: 'completed',
      read: true,
      readAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (responsibleProfileRef && responsibleProfileSnapshot?.exists) {
      const responsibleProfile = responsibleProfileSnapshot.data();
      const latestByPatient = responsibleProfile.latestPatientProfileRequests && typeof responsibleProfile.latestPatientProfileRequests === 'object'
        ? responsibleProfile.latestPatientProfileRequests
        : {};
      transaction.set(responsibleProfileRef, {
        latestPatientProfileRequests: {
          ...latestByPatient,
          [patientId]: {
            id: requestId,
            status: decision,
            createdAt: serializeDate(requestData.createdAt) || null,
            reviewedAt: new Date().toISOString(),
          },
        },
      }, { merge: true });
    }
  });

  const reviewedSnapshot = await requestRef.get();
  const reviewedRequest = serializePatientProfileChangeRequest(reviewedSnapshot);
  let patient = null;
  if (reviewedRequest?.patientId) {
    const patientSnapshot = await db.doc(`users/${ownerUserId}/patients/${reviewedRequest.patientId}`).get();
    if (patientSnapshot.exists) patient = serializeResponsiblePatientProfile(reviewedRequest.patientId, patientSnapshot.data());
  }
  return { request: reviewedRequest, patient };
}

const RESPONSIBLE_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_RESPONSIBLE_DOCUMENT_BYTES = 20 * 1024 * 1024;

function inferResponsibleDocumentMimeType(fileName, mimeType) {
  const explicit = normalizeText(mimeType, 120).toLowerCase();
  if (explicit) return explicit;
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic')) return 'image/heic';
  if (name.endsWith('.heif')) return 'image/heif';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

async function prepareResponsibleDocumentUpload(db, decodedToken, body, req) {
  const { profile, linkedPatientIds, ownerUserId } = await requireResponsibleContext(db, decodedToken);
  const patientId = normalizeText(body.patientId, 128);
  if (!patientId || !linkedPatientIds.includes(patientId)) {
    throw accessError('access/patient-not-linked', 'O atendente informado não está vinculado a este acesso.', 403);
  }
  const patientRef = db.doc(`users/${ownerUserId}/patients/${patientId}`);
  const patientSnapshot = await patientRef.get();
  if (!patientSnapshot.exists) throw accessError('access/patient-not-found', 'Atendente não encontrado.', 404);

  const fileName = normalizeText(body.fileName, 220);
  const mimeType = inferResponsibleDocumentMimeType(fileName, body.mimeType);
  const sizeBytes = Number(body.sizeBytes || 0);
  const category = normalizeText(body.category, 120) || 'Outro';
  const note = normalizeText(body.note, 1000);
  if (!fileName) throw accessError('access/document-name-required', 'Não foi possível identificar o nome do documento.');
  if (!RESPONSIBLE_DOCUMENT_TYPES.has(mimeType)) {
    throw accessError('access/invalid-document-type', 'Envie um documento PDF, DOCX, JPG, PNG, WEBP ou HEIC.');
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw accessError('access/empty-document', 'O documento selecionado está vazio.');
  if (sizeBytes > MAX_RESPONSIBLE_DOCUMENT_BYTES) throw accessError('access/document-too-large', 'O documento deve ter no máximo 20 MB.', 413);

  const responsibleName = normalizeText(profile.displayName || decodedToken.name, 120) || 'Responsável';
  const documentRef = patientRef.collection('portalDocuments').doc();
  const upload = await createResponsibleDocumentUploadSession({
    ownerUserId,
    patientId,
    responsibleUid: decodedToken.uid,
    documentId: documentRef.id,
    fileName,
    mimeType,
    fileSize: sizeBytes,
    browserOrigin: resolvePlatformUrl(req),
  });
  await documentRef.set({
    patientId,
    fileName,
    mimeType,
    sizeBytes,
    category,
    note,
    responsibleUid: decodedToken.uid,
    responsibleName,
    responsibleEmail: normalizeEmail(profile.email || decodedToken.email),
    status: 'uploading',
    driveName: upload.driveName,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { documentId: documentRef.id, uploadUrl: upload.uploadUrl };
}

async function finalizeResponsibleDocumentUpload(db, decodedToken, body) {
  const { profile, linkedPatientIds, ownerUserId } = await requireResponsibleContext(db, decodedToken);
  const patientId = normalizeText(body.patientId, 128);
  const documentId = normalizeText(body.documentId, 128);
  const driveFileId = normalizeText(body.driveFileId, 256);
  if (!patientId || !linkedPatientIds.includes(patientId)) {
    throw accessError('access/patient-not-linked', 'O atendente informado não está vinculado a este acesso.', 403);
  }
  if (!documentId || !driveFileId) throw accessError('access/invalid-document-upload', 'Não foi possível confirmar o documento enviado.');
  const patientRef = db.doc(`users/${ownerUserId}/patients/${patientId}`);
  const documentRef = patientRef.collection('portalDocuments').doc(documentId);
  const [patientSnapshot, documentSnapshot] = await Promise.all([patientRef.get(), documentRef.get()]);
  if (!patientSnapshot.exists) throw accessError('access/patient-not-found', 'Atendente não encontrado.', 404);
  if (!documentSnapshot.exists) throw accessError('access/document-not-found', 'O registro temporário do documento não foi encontrado.', 404);
  const document = documentSnapshot.data();
  if (document.responsibleUid !== decodedToken.uid) throw accessError('access/document-owner-mismatch', 'Este envio pertence a outro responsável.', 403);
  const metadata = await getDriveFileMetadata(driveFileId);
  assertOwnedResponsibleDocument(metadata, ownerUserId, patientId);
  if (metadata.appProperties?.documentId !== documentId || metadata.appProperties?.responsibleUid !== decodedToken.uid) {
    throw accessError('access/document-metadata-mismatch', 'O Google Drive retornou um documento diferente do envio autorizado.', 409);
  }

  const responsibleName = normalizeText(profile.displayName || decodedToken.name, 120) || 'Responsável';
  const responsibleEmail = normalizeEmail(profile.email || decodedToken.email);
  const patientName = normalizeText(patientSnapshot.data().name, 120) || 'atendente';
  const clientContext = normalizeClientContext({
    portalTab: 'profile',
    actionLocation: 'Portal do Responsável / Atualização cadastral / Documentos',
    ...(body.clientContext && typeof body.clientContext === 'object' ? body.clientContext : {}),
  });
  const createdAtIso = new Date().toISOString();
  const summary = {
    id: documentId,
    fileName: normalizeText(document.fileName, 220),
    mimeType: normalizeText(metadata.mimeType || document.mimeType, 120),
    sizeBytes: Number(metadata.size || document.sizeBytes || 0),
    category: normalizeText(document.category, 120) || 'Outro',
    note: normalizeText(document.note, 1000),
    uploadedByName: responsibleName,
    createdAt: createdAtIso,
  };
  const notificationRef = db.collection(`users/${ownerUserId}/portalNotifications`).doc();
  const details = [
    notificationDetail('Ação', 'Documento anexado ao cadastro'),
    notificationDetail('Categoria', summary.category),
    notificationDetail('Nome do arquivo', summary.fileName),
    notificationDetail('Tipo do arquivo', summary.mimeType),
    notificationDetail('Tamanho', `${summary.sizeBytes} bytes`),
    notificationDetail('Observação informada', summary.note || 'Sem observação'),
  ];
  const batch = db.batch();
  batch.set(documentRef, {
    driveFileId,
    mimeType: summary.mimeType,
    sizeBytes: summary.sizeBytes,
    status: 'available',
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(patientRef, {
    responsibleDocuments: FieldValue.arrayUnion(summary),
    lastResponsiblePortalUpdate: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(notificationRef, {
    type: 'patient_document_upload',
    ...notificationBaseFields('patient_document_upload'),
    title: 'Cadastro atualizado pelo responsável',
    message: `${responsibleName} atualizou o cadastro de ${patientName} e anexou ${summary.category.toLowerCase()}.`,
    patientId,
    patientName,
    documentId,
    responsibleUid: decodedToken.uid,
    responsibleName,
    responsibleEmail,
    actionLocation: clientContext.actionLocation,
    actionTarget: summary.fileName,
    navigationTarget: 'patient_documents',
    clientContext,
    details,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { document: { ...summary, patientId, status: 'available' } };
}

async function getResponsibleDocumentUrl(db, decodedToken, body, req) {
  const { linkedPatientIds, ownerUserId } = await requireResponsibleContext(db, decodedToken);
  const patientId = normalizeText(body.patientId, 128);
  const documentId = normalizeText(body.documentId, 128);
  if (!patientId || !linkedPatientIds.includes(patientId)) {
    throw accessError('access/patient-not-linked', 'O atendente informado não está vinculado a este acesso.', 403);
  }
  const documentSnapshot = await db.doc(`users/${ownerUserId}/patients/${patientId}/portalDocuments/${documentId}`).get();
  if (!documentSnapshot.exists || documentSnapshot.data().status !== 'available') {
    throw accessError('access/document-not-found', 'O documento não está disponível.', 404);
  }
  const driveFileId = normalizeText(documentSnapshot.data().driveFileId, 256);
  const metadata = await getDriveFileMetadata(driveFileId);
  assertOwnedResponsibleDocument(metadata, ownerUserId, patientId);
  return {
    ...createSignedResponsibleDocumentUrl({ req, fileId: driveFileId, ownerUserId }),
    fileName: normalizeText(documentSnapshot.data().fileName, 220) || 'documento',
  };
}

async function getProfessionalResponsibleDocumentUrl(db, decodedToken, body, req) {
  requirePrimaryAdmin(decodedToken);
  const ownerUserId = await getPrimaryAdminUid();
  const patientId = normalizeText(body.patientId, 128);
  const documentId = normalizeText(body.documentId, 128);
  const documentSnapshot = await db.doc(`users/${ownerUserId}/patients/${patientId}/portalDocuments/${documentId}`).get();
  if (!documentSnapshot.exists || documentSnapshot.data().status !== 'available') {
    throw accessError('access/document-not-found', 'O documento não está disponível.', 404);
  }
  const driveFileId = normalizeText(documentSnapshot.data().driveFileId, 256);
  const metadata = await getDriveFileMetadata(driveFileId);
  assertOwnedResponsibleDocument(metadata, ownerUserId, patientId);
  return {
    ...createSignedResponsibleDocumentUrl({ req, fileId: driveFileId, ownerUserId }),
    fileName: normalizeText(documentSnapshot.data().fileName, 220) || 'documento',
  };
}

async function recordResponsibleAction(db, decodedToken, body) {
  const { profile, linkedPatientIds, ownerUserId } = await requireResponsibleContext(db, decodedToken);
  const actionType = normalizeText(body.eventType, 40);
  const allowed = new Set([
    'gallery_access',
    'media_view',
    'media_view_summary',
    'video_playback',
    'media_download',
    'media_share_instagram',
    'media_share_whatsapp',
    'media_like',
    'media_unlike',
    'media_comment',
  ]);
  if (!allowed.has(actionType)) {
    throw accessError('access/invalid-responsible-action', 'A ação informada é inválida.');
  }

  const patientId = normalizeText(body.patientId, 128);
  if (!patientId || !linkedPatientIds.includes(patientId)) {
    throw accessError('access/patient-not-linked', 'O atendente informado não está vinculado a este acesso.', 403);
  }

  const responsibleName = normalizeText(profile.displayName || decodedToken.name, 120) || 'Responsável';
  const responsibleEmail = normalizeEmail(profile.email || decodedToken.email);
  const clientContext = normalizeClientContext({
    portalTab: 'gallery',
    actionLocation: 'Portal do Responsável / Galeria de atividades',
    ...(body.clientContext && typeof body.clientContext === 'object' ? body.clientContext : {}),
  });

  if (actionType === 'gallery_access') {
    const notificationId = crypto.createHash('sha256')
      .update(`${decodedToken.uid}:${patientId}:last-gallery-access`)
      .digest('hex');
    const notificationRef = db.doc(`users/${ownerUserId}/portalNotifications/${notificationId}`);
    const patientSnapshot = await db.doc(`users/${ownerUserId}/patients/${patientId}`).get();
    if (!patientSnapshot.exists) throw accessError('access/patient-not-found', 'Atendente não encontrado.', 404);
    const patientName = normalizeText(patientSnapshot.data().name, 120) || 'atendente';
    const details = [
      notificationDetail('Ação', 'Última consulta à Galeria de Atividades'),
      notificationDetail('Responsável', responsibleName),
      notificationDetail('Atendente', patientName),
      notificationDetail('Local', clientContext.actionLocation || 'Portal do Responsável / Galeria de atividades'),
    ];
    const portalSessionId = normalizeText(body.portalSessionId, 128);
    const existingGallery = await notificationRef.get();
    const existingGalleryData = existingGallery.exists ? existingGallery.data() : null;
    const sameGallerySession = Boolean(
      portalSessionId
      && existingGalleryData
      && normalizeText(existingGalleryData.portalSessionId, 128) === portalSessionId
    );
    if (sameGallerySession) return { recorded: false, notificationId: notificationRef.id };
    await notificationRef.set({
      id: notificationRef.id,
      type: 'gallery_access',
      ...notificationBaseFields('gallery_access'),
      portalSessionId: portalSessionId || null,
      title: 'Última consulta à galeria',
      message: `${responsibleName} consultou a Galeria de Atividades de ${patientName}.`,
      patientId,
      patientName,
      responsibleUid: decodedToken.uid,
      responsibleName,
      responsibleEmail,
      actionLocation: clientContext.actionLocation,
      actionTarget: `Galeria de ${patientName}`,
      navigationTarget: 'patient_gallery',
      clientContext,
      details,
      read: false,
      readAt: null,
      lastGalleryAccessAt: FieldValue.serverTimestamp(),
      createdAt: existingGalleryData?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { recorded: true, notificationId: notificationRef.id };
  }

  const passiveActions = new Set([
    'media_view',
    'media_view_summary',
    'video_playback',
    'media_download',
    'media_share_instagram',
    'media_share_whatsapp',
  ]);
  if (passiveActions.has(actionType)) {
    return { recorded: false, notificationId: null };
  }

  const recordId = normalizeText(body.recordId, 128);
  if (!recordId) throw accessError('access/missing-media', 'Não foi possível identificar a mídia.');

  const patientRef = db.doc(`users/${ownerUserId}/patients/${patientId}`);
  const patientSnapshot = await patientRef.get();
  if (!patientSnapshot.exists) throw accessError('access/patient-not-found', 'Atendente não encontrado.', 404);
  const mediaSnapshot = await patientRef.collection('activityRecords').doc(recordId).get();
  if (!mediaSnapshot.exists || !canShareActivityWithGuardian(patientSnapshot.data(), mediaSnapshot.data())) {
    throw accessError('access/media-not-available', 'A mídia não está disponível para este responsável.', 403);
  }

  if (actionType === 'media_like' || actionType === 'media_unlike') {
    const likeId = crypto
      .createHash('sha256')
      .update(`${decodedToken.uid}:${patientId}:${recordId}:like`)
      .digest('hex');
    await db.doc(`users/${ownerUserId}/portalMediaInteractions/${likeId}`).set({
      type: 'like',
      active: actionType === 'media_like',
      patientId,
      recordId,
      responsibleUid: decodedToken.uid,
      responsibleName,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { liked: actionType === 'media_like', recorded: false, notificationId: null };
  }

  const comment = normalizeText(body.comment, 1000);
  if (comment.length < 1) throw accessError('access/empty-comment', 'Digite um comentário antes de enviar.');
  const commentRef = db.collection(`users/${ownerUserId}/portalMediaInteractions`).doc();
  await commentRef.set({
    type: 'comment',
    active: true,
    patientId,
    recordId,
    responsibleUid: decodedToken.uid,
    responsibleName,
    comment,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {
    recorded: false,
    notificationId: null,
    comment: {
      id: commentRef.id,
      responsibleName,
      comment,
      createdAt: new Date().toISOString(),
      isOwn: true,
    },
  };
}

async function revokeRequest(db, decodedToken, body) {
  const requestId = normalizeText(body.requestId, 128);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
    throw accessError('access/invalid-request-id', 'A solicitação informada é inválida.');
  }

  const requestRef = db.collection('accessRequests').doc(requestId);
  const initialRequestSnapshot = await requestRef.get();
  if (!initialRequestSnapshot.exists) {
    throw accessError('access/request-not-found', 'A solicitação não foi encontrada.', 404);
  }

  const initialRequest = initialRequestSnapshot.data();
  if (initialRequest.status !== 'approved') {
    throw accessError(
      'access/not-approved',
      'Somente um acesso atualmente aprovado pode ser revogado.',
      409,
    );
  }

  const normalizedEmail = normalizeEmail(initialRequest.email);
  if (normalizedEmail === PRIMARY_ADMIN_EMAIL) {
    throw accessError(
      'access/primary-admin-protected',
      'O acesso do administrador principal não pode ser revogado.',
      403,
    );
  }

  const approvalRef = db.collection('accessApprovals').doc(emailDocumentId(normalizedEmail));
  const matchingProfiles = await findProfilesByEmail(db, normalizedEmail);
  const initialApprovalSnapshot = await approvalRef.get();
  const initialApproval = initialApprovalSnapshot.exists ? initialApprovalSnapshot.data() : {};
  const profileRefs = new Map(matchingProfiles.map(snapshot => [snapshot.id, snapshot.ref]));
  const linkedUids = [initialRequest.uid, initialApproval.linkedUid].filter(Boolean);
  for (const uid of linkedUids) {
    const profileRef = db.collection('accessProfiles').doc(String(uid));
    const profileSnapshot = await profileRef.get();
    if (profileSnapshot.exists) profileRefs.set(profileSnapshot.id, profileSnapshot.ref);
  }
  const revokedBy = decodedToken.uid;
  const revokedByEmail = normalizeEmail(decodedToken.email);

  await db.runTransaction(async transaction => {
    const requestSnapshot = await transaction.get(requestRef);
    const approvalSnapshot = await transaction.get(approvalRef);
    if (!requestSnapshot.exists) {
      throw accessError('access/request-not-found', 'A solicitação não foi encontrada.', 404);
    }

    const request = requestSnapshot.data();
    if (request.status !== 'approved') {
      throw accessError(
        'access/not-approved',
        'Este acesso não está mais aprovado. Atualize a lista antes de tentar novamente.',
        409,
      );
    }

    transaction.set(requestRef, {
      status: 'revoked',
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: revokedBy,
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy,
      revokedByEmail,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const approval = approvalSnapshot.exists ? approvalSnapshot.data() : {};
    transaction.set(approvalRef, {
      email: normalizedEmail,
      normalizedEmail,
      displayName: normalizeText(request.displayName, 120),
      phone: normalizeText(request.phone, 24),
      role: ACCESS_ROLES.has(request.role) ? request.role : 'professional',
      status: 'revoked',
      linkedPatientIds: Array.isArray(approval.linkedPatientIds) ? approval.linkedPatientIds : [],
      requestId,
      linkedUid: request.uid || approval.linkedUid || null,
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy,
      revokedByEmail,
      createdAt: approval.createdAt || request.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    for (const profileRef of profileRefs.values()) {
      transaction.set(profileRef, {
        status: 'revoked',
        revokedAt: FieldValue.serverTimestamp(),
        revokedBy,
        revokedByEmail,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  return requestRef.get();
}

function isQuotaExceededError(error) {
  const code = String(error?.code ?? '').toUpperCase();
  const message = String(error?.message || '').toUpperCase();
  return code === '8'
    || code.includes('RESOURCE_EXHAUSTED')
    || message.includes('RESOURCE_EXHAUSTED')
    || message.includes('QUOTA EXCEEDED');
}

function sendError(res, error) {
  if (isQuotaExceededError(error)) {
    res.setHeader('Retry-After', '60');
    console.error('[ACCESS API] access/quota-temporarily-unavailable', error?.message || error);
    return res.status(503).json({
      error: {
        code: 'access/quota-temporarily-unavailable',
        message: 'O serviço de acesso está temporariamente indisponível. Aguarde um minuto e tente novamente.',
      },
    });
  }

  const statusCode = Number(error?.statusCode) || 500;
  const code = error?.code || 'access/internal-error';
  const message = error?.message || 'Não foi possível processar o controle de acesso.';
  if (statusCode >= 500) console.error('[ACCESS API]', code, message);
  return res.status(statusCode).json({ error: { code, message } });
}

export default async function handler(req, res) {
  setSecurityHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      throw accessError('access/method-not-allowed', 'Método não permitido.', 405);
    }

    const db = getAdminDb();

    if (req.method === 'GET') {
      const decodedToken = await verifyFirebaseRequest(req);
      if (req.query?.mode === 'requests') {
        requirePrimaryAdmin(decodedToken);
        return res.status(200).json({ requests: await listAccessRequests(db) });
      }
      if (req.query?.mode === 'responsiblePortal') {
        return res.status(200).json(await getResponsiblePortalData(db, decodedToken, req));
      }
      if (req.query?.mode === 'adminResponsiblePreview') {
        return res.status(200).json(await getAdminResponsiblePortalData(db, decodedToken, req));
      }
      if (req.query?.mode === 'professionalNotifications') {
        return res.status(200).json(await listProfessionalNotifications(db, decodedToken, req));
      }
      if (req.query?.action === 'listPatientProfileChangeRequests') {
        return res.status(200).json(await listPatientProfileChangeRequests(db, decodedToken, req));
      }
      const snapshot = await getProfile(db, decodedToken);
      return res.status(200).json({ profile: snapshot.exists ? serializeProfile(snapshot.data()) : null });
    }

    const body = parseBody(req);
    if (body.action === 'reviewAccess') {
      const decodedToken = await verifyFirebaseRequest(req);
      requirePrimaryAdmin(decodedToken);
      const snapshot = await reviewRequest(db, decodedToken, body, resolvePlatformUrl(req));
      return res.status(200).json({ request: serializeRequest(snapshot), profile: null });
    }

    if (body.action === 'revokeAccess') {
      const decodedToken = await verifyFirebaseRequest(req);
      requirePrimaryAdmin(decodedToken);
      const snapshot = await revokeRequest(db, decodedToken, body);
      return res.status(200).json({ request: serializeRequest(snapshot), profile: null });
    }

    if (body.action === 'linkResponsiblePatient') {
      const decodedToken = await verifyFirebaseRequest(req);
      requirePrimaryAdmin(decodedToken);
      const snapshot = await linkResponsiblePatient(db, decodedToken, body);
      return res.status(200).json({ request: serializeRequest(snapshot), profile: null });
    }

    if (body.action === 'markProfessionalNotificationsRead') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await markProfessionalNotificationsRead(db, decodedToken, body));
    }

    if (body.action === 'manageProfessionalNotifications') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await manageProfessionalNotifications(db, decodedToken, body));
    }

    if (body.action === 'prepareResponsibleDocumentUpload') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await prepareResponsibleDocumentUpload(db, decodedToken, body, req));
    }

    if (body.action === 'finalizeResponsibleDocumentUpload') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await finalizeResponsibleDocumentUpload(db, decodedToken, body));
    }

    if (body.action === 'getResponsibleDocumentUrl') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await getResponsibleDocumentUrl(db, decodedToken, body, req));
    }

    if (body.action === 'getProfessionalResponsibleDocumentUrl') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await getProfessionalResponsibleDocumentUrl(db, decodedToken, body, req));
    }

    if (body.action === 'recordResponsibleAction') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await recordResponsibleAction(db, decodedToken, body));
    }

    if (body.action === 'getResponsiblePatientPhotoUrl') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await getResponsiblePatientPhotoUrl(db, decodedToken, body, req));
    }

    if (body.action === 'getAdminResponsiblePatientPhotoUrl') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await getAdminResponsiblePatientPhotoUrl(db, decodedToken, body, req));
    }

    if (body.action === 'requestResponsiblePatientUpdate' || body.action === 'updateResponsiblePatient') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await requestResponsiblePatientUpdate(db, decodedToken, body));
    }

    if (body.action === 'reviewPatientProfileChangeRequest') {
      const decodedToken = await verifyFirebaseRequest(req);
      return res.status(200).json(await reviewPatientProfileChangeRequest(db, decodedToken, body));
    }

    if (body.action !== 'requestAccess') {
      throw accessError('access/invalid-action', 'A ação solicitada é inválida.');
    }

    const decodedToken = await verifyFirebaseRequest(req);
    if (normalizeEmail(decodedToken?.email) === PRIMARY_ADMIN_EMAIL) {
      throw accessError('access/admin-request-not-required', 'O administrador principal já possui acesso aprovado.', 409);
    }

    const input = validateRequest(body, decodedToken);
    const result = await createPendingRequest(db, decodedToken, input);
    await notifyAdminAndRecord(result.request, input);
    return res.status(201).json({
      request: serializeRequest(result.request),
      profile: result.profile?.exists ? serializeProfile(result.profile.data()) : null,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
