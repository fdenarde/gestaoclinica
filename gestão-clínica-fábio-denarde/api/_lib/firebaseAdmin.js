import fs from 'fs';
import path from 'path';
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const STAGING_FIREBASE_PROJECT_ID = 'gestao-psicologia-stg-260815';
export const PRODUCTION_FIREBASE_PROJECT_ID = 'ai-studio-applet-webapp-e3283';
export const PUBLIC_BOOKING_FIREBASE_PROJECTS = Object.freeze({
  staging: STAGING_FIREBASE_PROJECT_ID,
  production: PRODUCTION_FIREBASE_PROJECT_ID,
});

export function resolvePublicBookingFirebaseProjectId(environment = process.env.PUBLIC_BOOKING_ENVIRONMENT) {
  const normalizedEnvironment = String(environment || '').trim();
  const projectId = PUBLIC_BOOKING_FIREBASE_PROJECTS[normalizedEnvironment];
  if (!projectId) {
    throw new Error('PUBLIC_BOOKING_ENVIRONMENT deve ser explicitamente staging ou production.');
  }
  return projectId;
}

function parseServiceAccountFromEnvironment() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    try {
      let raw;
      try {
        raw = JSON.parse(json);
      } catch {
        // Some Vercel env pulls materialize the escaped private-key newlines.
        raw = JSON.parse(json.replace(/\r?\n/g, '\\n'));
      }
      return {
        projectId: raw.project_id || raw.projectId,
        clientEmail: raw.client_email || raw.clientEmail,
        privateKey: raw.private_key || raw.privateKey,
      };
    } catch (error) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON inválido: ${error.message}`);
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

function parseLocalServiceAccount() {
  const localPath = path.resolve(process.cwd(), 'firebase-key.json');
  if (!fs.existsSync(localPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    return {
      projectId: raw.project_id || raw.projectId,
      clientEmail: raw.client_email || raw.clientEmail,
      privateKey: raw.private_key || raw.privateKey,
    };
  } catch (error) {
    throw new Error(`firebase-key.json inválido: ${error.message}`);
  }
}

function ensureFirebaseAdmin() {
  if (getApps().length > 0) return getApp();

  const serviceAccount = parseServiceAccountFromEnvironment() || parseLocalServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      'Credenciais do Firebase Admin ausentes. Configure FIREBASE_SERVICE_ACCOUNT_JSON na Vercel ou mantenha firebase-key.json apenas no ambiente local.',
    );
  }

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId,
  });
}

export function assertStagingFirebaseProject() {
  if (process.env.FIREBASE_PROJECT_ID?.trim() !== STAGING_FIREBASE_PROJECT_ID) {
    throw new Error('A operação remota de staging exige FIREBASE_PROJECT_ID explicitamente apontando para o Firebase de homologação.');
  }
  const app = ensureFirebaseAdmin();
  if (app.options.projectId !== STAGING_FIREBASE_PROJECT_ID) {
    throw new Error('A credencial carregada não pertence ao Firebase de homologação autorizado.');
  }
  return app;
}

export function assertPublicBookingFirebaseProject() {
  const expectedProjectId = resolvePublicBookingFirebaseProjectId();
  if (process.env.FIREBASE_PROJECT_ID?.trim() !== expectedProjectId) {
    throw new Error('O adapter público exige FIREBASE_PROJECT_ID compatível com o ambiente explicitamente selecionado.');
  }
  const app = ensureFirebaseAdmin();
  if (app.options.projectId !== expectedProjectId) {
    throw new Error('A credencial carregada não pertence ao projeto Firebase selecionado para o agendamento público.');
  }
  return app;
}

function resolveFirestoreDatabaseId() {
  const configured = process.env.FIRESTORE_DATABASE_ID?.trim();
  if (configured) return configured;

  try {
    const firebaseConfigPath = path.resolve(process.cwd(), 'firebase.json');
    if (fs.existsSync(firebaseConfigPath)) {
      const config = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
      const firestoreEntry = Array.isArray(config.firestore) ? config.firestore[0] : config.firestore;
      if (firestoreEntry?.database) return firestoreEntry.database;
    }
  } catch (error) {
    console.warn('[FIREBASE ADMIN] Não foi possível ler o databaseId do firebase.json:', error?.message || error);
  }

  return undefined;
}

export function getAdminDb() {
  const app = ensureFirebaseAdmin();
  const databaseId = resolveFirestoreDatabaseId();
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}

export function classifyFirebaseTokenVerificationError(verificationError) {
  const sourceCode = String(verificationError?.code || '').toLowerCase();
  const sourceMessage = String(verificationError?.message || '').toLowerCase();
  const isExpired = sourceCode === 'auth/id-token-expired' || sourceMessage.includes('expired');
  const isProjectMismatch = sourceCode.includes('invalid-audience')
    || sourceCode.includes('invalid-issuer')
    || sourceMessage.includes('audience')
    || sourceMessage.includes('issuer');
  if (isExpired) {
    return {
      code: 'drive-api/expired-auth-token',
      message: 'Sua sessão expirou. Entre novamente no sistema.',
      tokenVerificationResult: 'EXPIRED',
    };
  }
  if (isProjectMismatch) {
    return {
      code: 'drive-api/project-mismatch',
      message: 'Não foi possível validar esta sessão. Entre novamente no sistema.',
      tokenVerificationResult: 'PROJECT_MISMATCH',
    };
  }
  return {
    code: 'drive-api/invalid-auth-token',
    message: 'Não foi possível validar esta sessão. Entre novamente no sistema.',
    tokenVerificationResult: 'INVALID',
  };
}

export async function verifyFirebaseRequest(req) {
  ensureFirebaseAdmin();

  const authorization = req.headers?.authorization || req.headers?.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(authorization));
  if (!match) {
    const error = new Error('Sessão não identificada. Entre novamente no sistema.');
    error.statusCode = 401;
    error.code = 'drive-api/missing-auth-token';
    error.tokenVerificationResult = 'MISSING';
    throw error;
  }

  try {
    return await getAuth().verifyIdToken(match[1]);
  } catch (verificationError) {
    const classification = classifyFirebaseTokenVerificationError(verificationError);
    const error = new Error(classification.message);
    error.statusCode = 401;
    error.code = classification.code;
    error.tokenVerificationResult = classification.tokenVerificationResult;
    throw error;
  }
}
