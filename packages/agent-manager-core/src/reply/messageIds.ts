import { createHash } from 'node:crypto';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `msg_id` of the socket frame for a message id. Claude Code keeps `msg_id` in the transcript origin (`origin.msg_id`) only when it has the
 * shape of a UUID (8-4-4-4-12 hex digits, any version, case-insensitive; read in the 2.1.325 binary, measured), so a message id that is not one
 * (`m-...`) is mapped to a UUID derived from it: the same id always gives the same value, so the delivery state can be matched later from the id
 * alone. A message id that already is a UUID is used as is (lower-cased).
 */
export function wireMsgId(id: string): string {
  if (UUID_SHAPE.test(id)) {
    return id.toLowerCase();
  }
  const hex = createHash('sha256').update(`agent-manager:msg:${id}`).digest('hex');
  // Version nibble 5 and variant 10xx: a well-formed (name-based) UUID, not a random one.
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
