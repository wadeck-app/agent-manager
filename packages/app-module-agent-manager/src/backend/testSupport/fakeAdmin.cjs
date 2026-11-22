'use strict';

// A FAKE of scripts/admin.js of the w-guardrails plugin, for the tests only. It prints the shapes of the contract and the failure cases.
// It never touches a plugin state file: the grants it knows live in the file named by FAKE_ADMIN_GRANTS_FILE (a JSON array of list entries), which the test owns.
//
// FAKE_ADMIN_SCENARIO: ok (default) | corrupt | bad-schema | no-schema | not-json | wrong-type | usage | exit7 | hang | huge | error-as-success | revoke-mismatch | revoke-fails (list works, revoke exits 1)
// FAKE_ADMIN_LOG: when set, one JSON line per call is appended there (the argv), so a test can read what was run.

const fs = require('fs');

const argv = process.argv.slice(2);
const scenario = process.env.FAKE_ADMIN_SCENARIO || 'ok';

if (process.env.FAKE_ADMIN_LOG) {
  fs.appendFileSync(process.env.FAKE_ADMIN_LOG, JSON.stringify({ argv }) + '\n');
}

function flag(name) {
  const i = argv.indexOf('--' + name);
  return i === -1 ? undefined : argv[i + 1];
}

function out(value, code) {
  process.stdout.write((typeof value === 'string' ? value : JSON.stringify(value)) + '\n', () => process.exit(code));
}

function grantsOf() {
  const file = process.env.FAKE_ADMIN_GRANTS_FILE;
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

const sub = argv[1];
const cwd = flag('cwd');

if (scenario === 'usage') {
  process.stderr.write('Unknown flag "--session".\n\nUsage: fake\n');
  process.exit(2);
}
if (scenario === 'exit7') {
  process.stderr.write('something unexpected\n');
  process.exit(7);
}
if (scenario === 'hang') {
  setInterval(() => {}, 1000);
} else if (scenario === 'huge') {
  const chunk = 'x'.repeat(64 * 1024);
  let written = 0;
  const pump = () => {
    while (written < 4 * 1024 * 1024) {
      written += chunk.length;
      if (!process.stdout.write(chunk)) {
        process.stdout.once('drain', pump);
        return;
      }
    }
    process.exit(0);
  };
  pump();
} else if (scenario === 'corrupt') {
  out({ schema: 'w-guardrails.error/1', error: '/proj/.claude/bypass.json is not valid JSON (Unexpected token). Fix or delete the file; the hook ignores it meanwhile.' }, 1);
} else if (scenario === 'error-as-success') {
  out({ schema: 'w-guardrails.error/1', error: 'oops' }, 0);
} else if (scenario === 'not-json') {
  out('this is not json', 0);
} else if (scenario === 'no-schema') {
  out({ cwd, grants: [] }, 0);
} else if (scenario === 'bad-schema') {
  out({ schema: 'w-guardrails.bypass-list/2', cwd, now: new Date().toISOString(), grants: [] }, 0);
} else if (scenario === 'wrong-type') {
  out({ schema: 'w-guardrails.bypass-list/1', cwd, now: new Date().toISOString(), grants: [{ id: 'a1b2c3d4', category: 'rm', mode: 'once', session_id: 's', expires: new Date().toISOString(), remaining_ms: '600000', uses_left: 1, reason: '' }] }, 0);
} else if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
  out({ schema: 'w-guardrails.error/1', error: `--cwd "${cwd}" does not exist. Pass the project directory that contains .claude/.` }, 1);
} else if (sub === 'list') {
  const session = flag('session');
  const grants = grantsOf().filter((g) => !session || g.session_id === session);
  out({ schema: 'w-guardrails.bypass-list/1', cwd, now: new Date().toISOString(), grants }, 0);
} else if (sub === 'revoke') {
  const id = flag('id');
  const all = grantsOf();
  const found = all.find((g) => g.id === id);
  if (scenario === 'revoke-fails') {
    out({ schema: 'w-guardrails.error/1', error: 'Could not acquire the lock: another process is writing grants. Retry in a few seconds.' }, 1);
  } else if (!found) {
    out({ schema: 'w-guardrails.error/1', error: `No grant with id "${id}". Run "bypass list" to see current ids.` }, 1);
  } else {
    fs.writeFileSync(process.env.FAKE_ADMIN_GRANTS_FILE, JSON.stringify(all.filter((g) => g.id !== id)));
    out({ schema: 'w-guardrails.bypass-revoke/1', revoked: true, id: scenario === 'revoke-mismatch' ? 'ffffffff' : id, category: found.category, session_id: found.session_id }, 0);
  }
} else {
  process.stderr.write('Unknown subcommand\n');
  process.exit(2);
}
