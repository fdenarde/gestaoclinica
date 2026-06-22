import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type AuthError,
  type UserCredential,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const googleProvider = new GoogleAuthProvider();

interface CreateEmailAccountInput {
  displayName: string;
  email: string;
  password: string;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'Já existe uma conta com este e-mail. Entre com a conta existente e use “Solicitar outro tipo de acesso” para pedir um novo perfil. Não é necessário criar outra conta.',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'Informe um endereço de e-mail válido.',
  'auth/missing-password': 'Informe sua senha.',
  'auth/network-request-failed': 'Não foi possível conectar ao serviço de autenticação. Verifique sua internet.',
  'auth/operation-not-allowed': 'Login por e-mail e senha ainda não está disponível. Entre em contato com a clínica.',
  'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Permita pop-ups e tente novamente.',
  'auth/popup-closed-by-user': 'A janela do Google foi fechada antes da conclusão do acesso.',
  'auth/too-many-requests': 'Muitas tentativas foram realizadas. Aguarde alguns minutos e tente novamente.',
  'auth/user-disabled': 'Esta conta de autenticação foi desativada.',
  'auth/user-not-found': 'Não encontramos uma conta com este e-mail.',
  'auth/weak-password': 'Crie uma senha com pelo menos 6 caracteres.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
};

function toFriendlyAuthError(error: unknown): Error & { code?: string } {
  const authError = error as Partial<AuthError> | null;
  const code = authError?.code || 'auth/unknown';
  const message = AUTH_ERROR_MESSAGES[code] || 'Não foi possível concluir a autenticação. Tente novamente.';
  return Object.assign(new Error(message), { code });
}

export const loginWithGoogle = async (): Promise<UserCredential> => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error) {
    throw toFriendlyAuthError(error);
  }
};

export const loginWithEmail = async (email: string, password: string): Promise<UserCredential> => {
  try {
    return await signInWithEmailAndPassword(auth, email.trim(), password);
  } catch (error) {
    throw toFriendlyAuthError(error);
  }
};

export const createEmailAccount = async ({
  displayName,
  email,
  password,
}: CreateEmailAccountInput): Promise<UserCredential> => {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    try {
      await updateProfile(credential.user, { displayName: displayName.trim() });
    } catch (error) {
      console.warn('A conta foi criada, mas o nome do Firebase Auth não pôde ser atualizado.', error);
    }
    return credential;
  } catch (error) {
    if ((error as Partial<AuthError> | null)?.code === 'auth/operation-not-allowed') {
      throw Object.assign(
        new Error('O cadastro por e-mail e senha ainda precisa ser ativado pelo administrador. Avise a clínica para concluir a configuração.'),
        { code: 'auth/operation-not-allowed' },
      );
    }
    throw toFriendlyAuthError(error);
  }
};

export const requestPasswordReset = async (email: string): Promise<void> => {
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (error) {
    throw toFriendlyAuthError(error);
  }
};

export const logout = async (): Promise<void> => {
  try {
    await signOut(auth);
  } catch (error) {
    throw toFriendlyAuthError(error);
  }
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
