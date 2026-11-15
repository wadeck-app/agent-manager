/**
 * The write-route contract (T-08), shared by the backend and the UI. Runtime constants only (the only runtime code of commons/).
 *
 * Every route that is not a GET (pin, seen, reply, transport settings, anything added later) is refused with 403 unless the request has BOTH:
 * - `Sec-Fetch-Site: same-origin`: a browser sets it on a same-origin fetch and a page cannot change it; curl, node fetch and agents do not send it.
 * - the header `X-Agent-Manager-Csrf: <token>`, the token from `GET /api/modules/agent-manager/csrf` ({ ok, header, token }). Fetch it once per page load
 *   and send it on every non-GET request; on a 403 with code 'csrf-invalid' fetch a new one once (the module restarted) and retry.
 * This stops a web page and a naive script. It does NOT stop a same-user process that fetches the token and sets both headers itself (residual, threat-model T-08).
 */
export const CSRF_HEADER = 'X-Agent-Manager-Csrf';
export const CSRF_PATH = '/csrf';
