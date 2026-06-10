import fs from 'fs';
import path from 'path';
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function parseServiceAccountFromEnvironment() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    try {
      const raw = JSON.parse(json);
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
  });
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

export async function verifyFirebaseRequest(req) {
  ensureFirebaseAdmin();

  const authorization = req.headers?.authorization || req.headers?.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(authorization));
  if (!match) {
    const error = new Error('Sessão não identificada. Entre novamente no sistema.');
    error.statusCode = 401;
    error.code = 'drive-api/missing-auth-token';
    throw error;
  }

  try {
    return await getAuth().verifyIdToken(match[1]);
  } catch {
    const error = new Error('Sua sessão expirou. Entre novamente no sistema.');
    error.statusCode = 401;
    error.code = 'drive-api/invalid-auth-token';
    throw error;
  }
}
