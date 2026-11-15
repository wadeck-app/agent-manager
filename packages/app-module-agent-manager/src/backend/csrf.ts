import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CSRF_HEADER } from '../commons/csrf.js';

export interface CsrfRefusal {
  code: 'csrf-required' | 'csrf-invalid';
  message: string;
  hint: string;
}

type Headers = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
}

const HINT = 'The web UI sends it; a script must not call this route (T-08). In the web UI, reload the page.';

/**
 * Tokens of one module run: `<nonce>.<hmac(secret, nonce)>` with a secret made at start, so nothing is stored and a restart invalidates every token.
 * `check` returns undefined when the request may write, else why not.
 */
export function createCsrf(): { issue: () => string; check: (headers: Headers | undefined) => CsrfRefusal | undefined } {
  const secret = randomBytes(32);
  const sign = (nonce: string): string => createHmac('sha256', secret).update(nonce).digest('hex');
  return {
    issue: () => {
      const nonce = randomBytes(16).toString('hex');
      return `${nonce}.${sign(nonce)}`;
    },
    check: (headers) => {
      const site = single(headers?.['sec-fetch-site']);
      if (site !== 'same-origin') {
        return {
          code: 'csrf-required',
          message: `This route changes state and accepts only the web UI: the request has ${site === undefined ? 'no Sec-Fetch-Site header' : `Sec-Fetch-Site: ${site.slice(0, 40)}`} (required: same-origin)`,
          hint: HINT,
        };
      }
      const token = single(headers?.[CSRF_HEADER.toLowerCase()]);
      if (token === undefined || token === '') {
        return { code: 'csrf-required', message: `This route changes state and needs the header ${CSRF_HEADER} (token of GET /csrf)`, hint: HINT };
      }
      const [nonce, mac] = token.split('.');
      const given = Buffer.from(mac ?? '');
      const wanted = Buffer.from(nonce === undefined ? '' : sign(nonce));
      if (nonce === undefined || given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
        return {
          code: 'csrf-invalid',
          message: `The ${CSRF_HEADER} token is not one issued by this module run (the module restarted, or the token is wrong)`,
          hint: `Fetch a new token with GET /csrf and retry once. ${HINT}`,
        };
      }
      return undefined;
    },
  };
}
