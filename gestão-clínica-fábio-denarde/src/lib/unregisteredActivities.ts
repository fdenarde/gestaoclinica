import type { AppState } from '../types';
import type { ActivityRecord } from '../types/activityRecords';
import type { GooglePhotosAlbum } from '../types/googlePhotosAlbums';
import type { UnregisteredActivityResult } from '../types/unregisteredActivities';
import { buildActivityMediaPackageModel } from './activityMediaPackages';
import { listActivityMediaPresence } from './activityRecordsApi';
import { listGooglePhotosAlbums } from './googlePhotosAlbumsApi';
import { buildUnregisteredActivityGroups } from '../../shared/unregisteredActivities.js';
import { sessionAllowsActivity } from '../../shared/sessionScheduling.js';

function monitoringStartDate(state: AppState): string {
  const configured = String(state.settings?.activityMediaMonitoringStart || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(configured) ? configured : '';
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function loadUnregisteredActivities(
  state: AppState,
  options: { force?: boolean; now?: Date } = {},
): Promise<UnregisteredActivityResult> {
  const monitoringStart = monitoringStartDate(state);
  if (!monitoringStart) {
    return {
      groups: [],
      monitoringStart: '',
      warning: 'Defina em Ajustes a data de início do acompanhamento de atividades para evitar avisos históricos indevidos.',
    };
  }

  const now = options.now || new Date();
  const candidateSessions = state.sessions
    .filter(session => String(session.date || '') >= monitoringStart && sessionAllowsActivity(session));
  const candidatePatientIds = [...new Set(candidateSessions
    .map(session => String(session.patientId || ''))
    .filter(Boolean))];

  const activityPresencePromise = listActivityMediaPresence(
    candidateSessions.map(session => ({ sessionId: session.id, patientId: session.patientId })),
    { force: options.force },
  );
  const patientBundlesPromise = mapWithConcurrency(candidatePatientIds, 3, async patientId => {
    const patientSessions = state.sessions.filter(session => session.patientId === patientId);
    const patient = state.patients.find(item => item.id === patientId);
    const packageModel = buildActivityMediaPackageModel({
      patientId,
      sessions: patientSessions,
      payments: state.payments,
      packageTolerances: patient?.packageTolerances || [],
      now,
    });
    const packageResults = await mapWithConcurrency(packageModel.packages, 3, pkg => listGooglePhotosAlbums({
      patientId,
      packageNumber: pkg.number,
      scope: 'manage',
      force: options.force,
    }).catch(() => ({ albums: [] as GooglePhotosAlbum[] })));
    return {
      albums: packageResults.flatMap(result => Array.isArray(result.albums) ? result.albums : []),
    };
  });

  const [registeredSessionIds, patientBundles] = await Promise.all([
    activityPresencePromise,
    patientBundlesPromise,
  ]);
  const sessionsById = new Map(candidateSessions.map(session => [String(session.id), session]));
  const activityRecords = registeredSessionIds.flatMap(sessionId => {
    const session = sessionsById.get(String(sessionId));
    if (!session) return [];
    return [{
      id: `presence:${sessionId}`,
      patientId: session.patientId,
      sessionId,
      sessionIds: [sessionId],
      status: 'active',
    } as ActivityRecord];
  });
  const googlePhotosAlbums = patientBundles.flatMap(bundle => bundle.albums) as GooglePhotosAlbum[];
  const groups = buildUnregisteredActivityGroups({
    patients: state.patients,
    sessions: state.sessions,
    payments: state.payments,
    activityRecords,
    googlePhotosAlbums,
    monitoringStart,
    now,
  });

  return { groups, monitoringStart, warning: '' };
}
