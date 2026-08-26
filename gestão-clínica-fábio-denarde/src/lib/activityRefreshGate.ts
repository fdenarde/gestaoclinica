export type ActivityRefreshSignatureSource = string | (() => string);

export interface ActivityRefreshGate {
  schedule(
    signature: ActivityRefreshSignatureSource,
    task: () => Promise<void>,
    delayMs: number,
    force?: boolean,
  ): Promise<void>;
  runNow(
    signature: ActivityRefreshSignatureSource,
    task: () => Promise<void>,
    force?: boolean,
  ): Promise<void>;
  dispose(): void;
}
interface QueueEntry {
  source: ActivityRefreshSignatureSource;
  sourceKey: string;
  task: () => Promise<void>;
  force: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function sourceKey(source: ActivityRefreshSignatureSource): string {
  return typeof source === 'string' ? `literal:${source}` : 'dynamic';
}

export function createActivityRefreshGate(): ActivityRefreshGate {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: QueueEntry | null = null;
  let inFlight: { signature: string; promise: Promise<void> } | null = null;
  let lastCompletedSignature: string | null = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const resolveSource = (source: ActivityRefreshSignatureSource): string => (
    typeof source === 'function' ? String(source() || '') : source
  );

  const settleEntry = (entry: QueueEntry, error?: unknown) => {
    if (error === undefined) entry.resolve();
    else entry.reject(error);
  };

  const startPending = () => {
    if (disposed || !pending) return;
    const entry = pending;
    pending = null;
    startEntry(entry);
  };

  const startEntry = (entry: QueueEntry) => {
    const signature = resolveSource(entry.source);
    if (!signature || (!entry.force && lastCompletedSignature === signature)) {
      settleEntry(entry);
      return;
    }
    if (inFlight) {
      if (inFlight.signature === signature) {
        void inFlight.promise.then(() => settleEntry(entry), error => settleEntry(entry, error));
      } else {
        pending = entry;
      }
      return;
    }

    const promise = Promise.resolve().then(entry.task);
    inFlight = { signature, promise };
    void promise.then(
      () => {
        if (inFlight?.promise === promise) {
          inFlight = null;
          lastCompletedSignature = signature;
          settleEntry(entry);
          startPending();
        }
      },
      error => {
        if (inFlight?.promise === promise) {
          inFlight = null;
          settleEntry(entry, error);
          startPending();
        }
      },
    );
  };

  const createEntry = (
    signature: ActivityRefreshSignatureSource,
    task: () => Promise<void>,
    force: boolean,
  ): QueueEntry => {
    let resolvePromise!: () => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    return {
      source: signature,
      sourceKey: sourceKey(signature),
      task,
      force,
      resolve: resolvePromise,
      reject: rejectPromise,
      promise,
    };
  };

  const enqueue = (
    signature: ActivityRefreshSignatureSource,
    task: () => Promise<void>,
    force: boolean,
    delayMs: number,
  ): Promise<void> => {
    if (disposed) return Promise.resolve();
    const literalSignature = typeof signature === 'string' ? signature : null;
    if (literalSignature && inFlight?.signature === literalSignature) return inFlight.promise;
    if (literalSignature && !force && lastCompletedSignature === literalSignature) return Promise.resolve();

    const existing = pending && pending.sourceKey === sourceKey(signature) ? pending : null;
    const entry = existing || createEntry(signature, task, force);
    if (existing) {
      entry.task = task;
      entry.force = entry.force || force;
    } else {
      if (pending) settleEntry(pending);
      pending = entry;
    }
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      startPending();
    }, Math.max(0, delayMs));
    return entry.promise;
  };

  return {
    schedule(signature, task, delayMs, force = false) {
      return enqueue(signature, task, force, delayMs);
    },
    runNow(signature, task, force = false) {
      if (disposed) return Promise.resolve();
      const literalSignature = typeof signature === 'string' ? signature : null;
      if (literalSignature && inFlight?.signature === literalSignature) return inFlight.promise;
      if (literalSignature && !force && lastCompletedSignature === literalSignature) return Promise.resolve();
      clearTimer();
      if (pending) {
        settleEntry(pending);
        pending = null;
      }
      const entry = createEntry(signature, task, force);
      if (inFlight) pending = entry;
      else startEntry(entry);
      return entry.promise;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      if (pending) {
        settleEntry(pending);
        pending = null;
      }
    },
  };
}
