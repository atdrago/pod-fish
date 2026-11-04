/*
	A request that never answers would hold the publish lock, and the lock disables Stop.
	So every outside request of the app has a deadline.
*/
export const createTimedFetch =
  (fetchFunction: typeof fetch, timeoutMs: number): typeof fetch =>
  (input, init) =>
    fetchFunction(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
