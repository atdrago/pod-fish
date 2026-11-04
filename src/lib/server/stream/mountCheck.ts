import { errMessage, log } from '$lib/server/log';

type MountCheckResult = { ok: true } | { ok: false; message: string };

const hostOf = (mountUrl: string): string => new URL(mountUrl).host;

/*
	R30. The answer must be 200, an audio type, and at least one byte. The stream never
	ends, so this reads one chunk and hangs up.
*/
export const checkMount = async (
  { fetch: fetchFunction, userAgent }: { fetch: typeof fetch; userAgent: string },
  mountUrl: string
): Promise<MountCheckResult> => {
  const fail = (message: string, status?: number): MountCheckResult => {
    log.warn('live_mount_check_failed', { step: 'mount', status, host: hostOf(mountUrl) });

    return { ok: false, message };
  };

  try {
    const response = await fetchFunction(mountUrl, { headers: { 'user-agent': userAgent } });

    if (response.status !== 200) {
      await response.body?.cancel();

      return fail(`The mount ${mountUrl} answered ${String(response.status)}.`, response.status);
    }

    const contentType = response.headers.get('content-type') ?? 'no content type';

    if (!contentType.startsWith('audio/')) {
      await response.body?.cancel();

      return fail(`The mount ${mountUrl} answered with ${contentType}, not audio.`, 200);
    }

    const reader = response.body?.getReader();
    const firstChunk = await reader?.read();

    await reader?.cancel();

    return firstChunk?.value === undefined
      ? fail(`The mount ${mountUrl} answered 200 but sent no audio.`, 200)
      : { ok: true };
  } catch (error) {
    log.warn('live_mount_check_failed', {
      step: 'mount',
      host: hostOf(mountUrl),
      error: errMessage(error)
    });

    return { ok: false, message: `The app could not reach the mount ${mountUrl}.` };
  }
};
