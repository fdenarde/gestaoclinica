import { verifyFirebaseRequest } from './firebaseAdmin.js';

export async function resolveAccessContext(req) {
  const decodedToken = await verifyFirebaseRequest(req);
  return {
    userId: decodedToken.uid,
    ownerUserId: decodedToken.uid,
    workspaceId: decodedToken.uid,
    role: 'owner',
  };
}
