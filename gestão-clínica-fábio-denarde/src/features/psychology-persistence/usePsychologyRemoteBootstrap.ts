import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PsychologyStore } from '../psychology-pilot/psychologyDomain';
import { createClosedPsychologyCapabilities, type PsychologyCapabilities } from './capabilities';
import { resolvePsychologyRemoteBootstrap, type PsychologyRemoteBootstrapResult } from './remotePatientClient';

export interface PsychologyRemoteBootstrapClient {
  load: () => Promise<PsychologyStore>;
  getCapabilities: () => PsychologyCapabilities;
}

export interface PsychologyRemoteBootstrapState {
  remoteStore: PsychologyStore | null;
  setRemoteStore: Dispatch<SetStateAction<PsychologyStore | null>>;
  remoteCapabilities: PsychologyCapabilities;
  remoteLoading: boolean;
  remoteError: string;
}

const inFlightBootstraps = new WeakMap<PsychologyRemoteBootstrapClient, Promise<PsychologyRemoteBootstrapResult>>();

function bootstrapOnce(client: PsychologyRemoteBootstrapClient): Promise<PsychologyRemoteBootstrapResult> {
  const current = inFlightBootstraps.get(client);
  if (current) return current;
  const next = resolvePsychologyRemoteBootstrap(client.load);
  inFlightBootstraps.set(client, next);
  void next.finally(() => {
    if (inFlightBootstraps.get(client) === next) inFlightBootstraps.delete(client);
  });
  return next;
}

export function usePsychologyRemoteBootstrap(
  client: PsychologyRemoteBootstrapClient | null,
  enabled: boolean,
): PsychologyRemoteBootstrapState {
  const [remoteStore, setRemoteStore] = useState<PsychologyStore | null>(null);
  const [remoteCapabilities, setRemoteCapabilities] = useState<PsychologyCapabilities>(createClosedPsychologyCapabilities);
  const [remoteLoading, setRemoteLoading] = useState(enabled);
  const [remoteError, setRemoteError] = useState('');
  const executionRef = useRef(0);

  useEffect(() => {
    const execution = ++executionRef.current;
    if (!enabled || !client) {
      setRemoteLoading(false);
      return;
    }

    setRemoteLoading(true);
    setRemoteError('');
    void bootstrapOnce(client)
      .then(result => {
        if (execution !== executionRef.current) return;
        if (result.store) {
          setRemoteStore(result.store);
          setRemoteCapabilities(client.getCapabilities());
        } else {
          setRemoteStore(null);
          setRemoteCapabilities(createClosedPsychologyCapabilities());
          setRemoteError(result.error);
        }
      })
      .finally(() => {
        if (execution === executionRef.current) setRemoteLoading(false);
      });

    return () => {
      if (execution === executionRef.current) executionRef.current += 1;
    };
  }, [client, enabled]);

  return { remoteStore, setRemoteStore, remoteCapabilities, remoteLoading, remoteError };
}
