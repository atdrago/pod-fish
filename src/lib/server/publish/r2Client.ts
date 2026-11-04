import { AwsClient } from 'aws4fetch';
import { errMessage } from '$lib/server/log';

export type PutInput = {
  key: string;
  body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array<ArrayBuffer>>;
  length: number;
  contentType: string;
  cacheControl: string;
  sha256: string;
};

type PutResult = { ok: true } | { ok: false; status?: number; error?: string };
type HeadResult =
  { ok: true; sha256: string | undefined } | { ok: false; status?: number; error?: string };

export type ObjectStore = {
  put: (input: PutInput) => Promise<PutResult>;
  head: (key: string) => Promise<HeadResult>;
};

const HASH_METADATA_HEADER = 'x-amz-meta-sha256';
const HEAD_TIMEOUT_MS = 15_000;
const MINIMUM_PUT_TIMEOUT_MS = 30_000;

/* A slow home uplink still moves about 100 KB per second. */
const MINIMUM_UPLOAD_BYTES_PER_MS = 100;

const putTimeoutMs = (length: number): number =>
  Math.max(MINIMUM_PUT_TIMEOUT_MS, length / MINIMUM_UPLOAD_BYTES_PER_MS);

/* KTD6. A single PUT per object: every podcast file fits R2's 5 GiB limit for one PUT. */
export const createR2Client = ({
  accountId,
  bucket,
  accessKeyId,
  secretAccessKey,
  fetch: fetchFunction
}: {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetch: typeof fetch;
}): ObjectStore => {
  const signer = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });

  const objectUrl = (key: string): string =>
    `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

  return {
    put: async ({ key, body, length, contentType, cacheControl, sha256 }) => {
      try {
        /*
					The signature leaves the body out, so a media file streams from disk
					with no second read to hash it. TLS protects the bytes in transit.
				*/
        const signed = await signer.sign(objectUrl(key), {
          method: 'PUT',
          headers: {
            'cache-control': cacheControl,
            'content-length': String(length),
            'content-type': contentType,
            'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
            [HASH_METADATA_HEADER]: sha256
          }
        });
        /* Node needs `duplex` for a stream body. The DOM type of RequestInit leaves it out. */
        const init: RequestInit & { duplex: 'half' } = {
          method: 'PUT',
          headers: signed.headers,
          body,
          duplex: 'half',
          signal: AbortSignal.timeout(putTimeoutMs(length))
        };
        const response = await fetchFunction(signed.url, init);

        return response.ok ? { ok: true } : { ok: false, status: response.status };
      } catch (error) {
        return { ok: false, error: errMessage(error) };
      }
    },

    head: async (key) => {
      try {
        const signed = await signer.sign(objectUrl(key), { method: 'HEAD' });
        const response = await fetchFunction(signed.url, {
          method: 'HEAD',
          headers: signed.headers,
          signal: AbortSignal.timeout(HEAD_TIMEOUT_MS)
        });

        if (response.status === 404) {
          return { ok: true, sha256: undefined };
        }

        return response.ok
          ? { ok: true, sha256: response.headers.get(HASH_METADATA_HEADER) ?? undefined }
          : { ok: false, status: response.status };
      } catch (error) {
        return { ok: false, error: errMessage(error) };
      }
    }
  };
};
