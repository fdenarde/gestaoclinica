import { getAuth } from 'firebase-admin/auth';
import { getAdminDb, verifyFirebaseRequest } from './firebaseAdmin.js';
import {
  ACCESS_ROLES,
  assertAccessPermission,
  assertAllowedRole,
  assertPatientBinding,
  buildEffectiveAccessContext,
} from './accessPermissions.js';

const PRIMARY_ADMIN_EMAIL = 'fdenarde@gmail.com';
const PRIMARY_ADMIN_UID_CACHE_MS = 10 * 60 * 1000;
let primaryAdminUidCache = { uid: '', expiresAt: 0, inFlight: null };

function accessContextError(code, message, statusCode = 403) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function getPrimaryAdminUid() {
  const now = Date.now();
  if (primaryAdminUidCache.uid && primaryAdminUidCache.expiresAt > now) return primaryAdminUidCache.uid;
  if (primaryAdminUidCache.inFlight) return primaryAdminUidCache.inFlight;

  primaryAdminUidCache.inFlight = getAuth().getUserByEmail(PRIMARY_ADMIN_EMAIL)
    .then(user => {
      primaryAdminUidCache = {
        uid: user.uid,
        expiresAt: Date.now() + PRIMARY_ADMIN_UID_CACHE_MS,
        inFlight: null,
      };
      return user.uid;
    })
    .catch(error => {
      primaryAdminUidCache.inFlight = null;
      console.error('[ACTIVITY ACCESS] Não foi possível localizar o administrador principal:', error?.message || error);
      throw accessContextError(
        'activity-records/admin-workspace-unavailable',
        'O workspace principal da clínica não está disponível.',
        503,
      );
    });

  return primaryAdminUidCache.inFlight;
}

export function assertActivityPatientAccess(context, patientId) {
  try {
    return assertPatientBinding(
      context,
      patientId,
      'Você não possui autorização para acessar as atividades desta criança.',
    );
  } catch (error) {
    if (error?.code === 'access/invalid-patient') {
      throw accessContextError('activity-records/invalid-patient', 'Não foi possível identificar a criança.', 400);
    }
    if (error?.code === 'access/patient-access-denied') {
      throw accessContextError(
        'activity-records/patient-access-denied',
        'Você não possui autorização para acessar as atividades desta criança.',
        403,
      );
    }
    throw error;
  }
}

export { assertAccessPermission, assertPatientBinding };

export async function resolveAccessContext(req, options = {}) {
  const decodedToken = await verifyFirebaseRequest(req);
  const email = normalizeEmail(decodedToken.email);
  const isPrimaryAdmin = email === PRIMARY_ADMIN_EMAIL;
  const db = getAdminDb();

  let profile = null;
  let primaryAdminWorkspaceId = decodedToken.uid;

  if (!isPrimaryAdmin) {
    const profileSnapshot = await db.collection('accessProfiles').doc(decodedToken.uid).get();
    profile = profileSnapshot.exists ? profileSnapshot.data() || {} : null;
    if (!profile || !ACCESS_ROLES.has(String(profile.role || '').trim())) {
      throw accessContextError(
        'activity-records/internal-approved-required',
        'Acesso profissional aprovado obrigatório.',
        403,
      );
    }
    if (!String(profile.workspaceId || '').trim()) {
      primaryAdminWorkspaceId = await getPrimaryAdminUid();
    }
  }

  let context;
  try {
    context = buildEffectiveAccessContext({
      decodedToken,
      profile,
      primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
      primaryAdminWorkspaceId,
      requestedContext: options.requestedContext,
      globalBlocks: options.globalBlocks,
    });
  } catch (error) {
    if (error?.code === 'access/approved-profile-required') {
      throw accessContextError(
        'activity-records/internal-approved-required',
        'Acesso profissional aprovado obrigatório.',
        403,
      );
    }
    if (error?.code === 'access/workspace-unavailable') {
      throw accessContextError(
        'activity-records/admin-workspace-unavailable',
        'O workspace principal da clínica não está disponível.',
        503,
      );
    }
    throw error;
  }

  const allowedRoles = Array.isArray(options.allowedRoles)
    ? options.allowedRoles
    : ['admin', 'professional'];
  assertAllowedRole(context, allowedRoles);

  const requiredPermissions = Array.isArray(options.requiredPermissions)
    ? options.requiredPermissions
    : [];
  for (const permissionKey of requiredPermissions) {
    assertAccessPermission(context, permissionKey);
  }

  return context;
}
