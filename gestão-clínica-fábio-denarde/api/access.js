import crypto from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyFirebaseRequest } from './_lib/firebaseAdmin.js';
import { notifyAccessApproval, notifyAccessRequest } from './_lib/accessRequestNotification.js';
import { canShareActivityWithGuardian } from './_lib/activityRecordsValidation.js';

const PRIMARY_ADMIN_EMAIL = 'fdenarde@gmail.com';
const ACCESS_ROLES = new Set(['professional', 'responsible']);
const ACCESS_STATUSES = new Set(['pending', 'approved', 'rejected', 'revoked', 'disabled', 'canceled']);
const REQUEST_STATUSES = new Set(['pending', 'approved', 'rejected', 'revoked', 'disabled', 'canceled']);
const ALLOWED_ORIGINS = new Set([
  'https://gestaoclinica-solucoes.vercel.app',
  'https://fdenarde.github.io',
  'http://localhost:3000',
  'http://localhost:3001',
]);

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

function serializeProfile(data) {
  if (!data) return null;
  return {
    uid: String(data.uid || ''),
    email: normalizeEmail(data.email),
    displayName: normalizeText(data.displayName, 120),
    phone: normalizeText(data.phone, 24),
    role: ['admin', 'professional', 'responsible'].includes(data.role) ? data.role : 'professional',
    status: ACCESS_STATUSES.has(data.status) ? data.status : 'pending',
    createdAt: serializeDate(data.createdAt),
    approvedAt: serializeDate(data.approvedAt),
    approvedBy: data.approvedBy ? String(data.approvedBy) : null,
    revokedAt: serializeDate(data.revokedAt),
    revokedBy: data.revokedBy ? String(data.revokedBy) : null,
    revokedByEmail: data.revokedByEmail ? normalizeEmail(data.revokedByEmail) : null,
    linkedPatientIds: serializeLinkedPatientIds(data.linkedPatientIds),
    provider: normalizeText(data.provider, 80),
    requestId: data.requestId ? String(data.requestId) : null,
  };
}

function serializeLinkedPatientIds(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 1)
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
  return ALLOWED_ORIGINS.has(origin) ? origin : '';
}

async function ensurePrimaryAdminProfile(db, decodedToken) {
  const ref = db.collection('accessProfiles').doc(decodedToken.uid);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() : {};
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
  try {
    const adminUser = await getAuth().getUserByEmail(PRIMARY_ADMIN_EMAIL);
    return adminUser.uid;
  } catch (error) {
    console.error('[ACCESS API] Não foi possível localizar o administrador principal:', error?.message || error);
    throw accessError(
      'access/admin-workspace-unavailable',
      'O workspace principal da clínica não está disponível.',
      503,
    );
  }
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
  if (normalizedEmail === PRIMARY_ADMIN_EMAIL) return ensurePrimaryAdminProfile(db, decodedToken);

  const profileRef = db.collection('accessProfiles').doc(decodedToken.uid);
  const profileSnapshot = await profileRef.get();
  const currentStatus = profileSnapshot.exists ? profileSnapshot.data().status : null;
  if (['rejected', 'revoked', 'disabled', 'canceled'].includes(currentStatus)) {
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

  if (currentStatus === 'approved') return profileSnapshot;
  if (profileSnapshot.exists) return profileSnapshot;
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
  const linkedPatientIds = [patientId];

  await db.runTransaction(async transaction => {
    const [latestRequest, latestApproval] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(approvalRef),
    ]);
    if (!latestRequest.exists) {
      throw accessError('access/request-not-found', 'A solicitação não foi encontrada.', 404);
    }
    const currentRequest = latestRequest.data();
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

    const approval = latestApproval.exists ? latestApproval.data() : {};
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

function serializeResponsibleSession(snapshot) {
  const data = snapshot.data();
  const professionalName = normalizeText(
    data.professionalName || data.therapistName || data.providerName,
    120,
  );
  return {
    id: snapshot.id,
    patientId: normalizeText(data.patientId, 128),
    date: normalizeText(data.date, 10),
    time: normalizeText(data.time, 5),
    status: normalizeText(data.status, 40) || 'Agendada',
    type: normalizeText(data.type, 120),
    professionalName: professionalName || null,
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
    category: normalizeText(data.category, 80) || 'Atividade',
    mediaType: data.mediaType === 'video' || String(data.mimeType || '').startsWith('video/')
      ? 'video'
      : 'photo',
    fileName: normalizeText(data.fileName, 180) || 'mídia',
    mimeType: normalizeText(data.mimeType, 80),
    durationSeconds: Number.isFinite(Number(data.durationSeconds))
      ? Number(data.durationSeconds)
      : null,
  };
}

async function getResponsiblePortalData(db, decodedToken) {
  const profileSnapshot = await getProfile(db, decodedToken);
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  if (!profile || profile.status !== 'approved' || profile.role !== 'responsible') {
    throw accessError(
      'access/responsible-approved-required',
      'O Portal do Responsável está disponível somente para responsáveis aprovados.',
      403,
    );
  }

  const linkedPatientIds = serializeLinkedPatientIds(profile.linkedPatientIds);
  const baseResult = {
    responsible: {
      displayName: normalizeText(profile.displayName || decodedToken.name, 120),
      email: normalizeEmail(profile.email || decodedToken.email),
    },
    patient: null,
    sessions: [],
    media: [],
  };
  if (linkedPatientIds.length === 0) return baseResult;

  const patientId = linkedPatientIds[0];
  const ownerUserId = await getPrimaryAdminUid();
  const patientRef = db.doc(`users/${ownerUserId}/patients/${patientId}`);
  const patientSnapshot = await patientRef.get();
  if (!patientSnapshot.exists) return baseResult;

  const patient = patientSnapshot.data();
  const sessionsSnapshot = await db.collection(`users/${ownerUserId}/sessions`)
    .where('patientId', '==', patientId)
    .limit(500)
    .get();
  const sessions = sessionsSnapshot.docs
    .map(serializeResponsibleSession)
    .filter(session => session.patientId === patientId && /^\d{4}-\d{2}-\d{2}$/.test(session.date))
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  let media = [];
  if (patient.activityMediaAuthorization?.guardianSharingStatus === 'authorized') {
    const mediaSnapshot = await patientRef.collection('activityRecords').limit(250).get();
    media = mediaSnapshot.docs
      .filter(snapshot => {
        const record = snapshot.data();
        return record.patientId === patientId && canShareActivityWithGuardian(patient, record);
      })
      .map(serializeResponsibleMedia)
      .sort((a, b) => `${b.sessionDate}T${b.sessionTime}`.localeCompare(`${a.sessionDate}T${a.sessionTime}`));
  }

  return {
    ...baseResult,
    patient: {
      id: patientId,
      name: normalizeText(patient.name, 120) || 'Paciente',
    },
    sessions,
    media,
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

function sendError(res, error) {
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
        return res.status(200).json(await getResponsiblePortalData(db, decodedToken));
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
