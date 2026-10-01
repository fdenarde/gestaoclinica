export function runWithRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  createTimeoutError: () => Error,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutError = createTimeoutError();
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));

  return Promise.race([operationPromise, timeoutPromise])
    .catch(error => {
      if (timedOut) throw timeoutError;
      throw error;
    })
    .finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    });
}
