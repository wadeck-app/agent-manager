'use strict';

// A FAKE of scripts/admin.js of the w-guardrails plugin, for the tests only. It prints the shapes of the contract and the failure cases.
// It never touches a plugin state file: the grants it knows live in the file named by FAKE_ADMIN_GRANTS_FILE (a JSON array of list entries), which the test owns.
//
// FAKE_ADMIN_SCENARIO: ok (default) | corrupt | bad-schema | no-schema | not-json | wrong-type | usage | exit7 | hang | huge | error-as-success | revoke-mismatch | revoke-fails (list works, revoke exits 1)
// Grant scenarios (the "grant" subcommand reads the PIN access token on STDIN, nothing secret on argv, and appends the new entry with origin "ui" to the grants file):
//   grant-elevation | grant-pin-not-set | grant-unreachable | grant-spam | grant-not-bypassable (the plugin refuses) | grant-echo-token (its error text contains the token)
//   grant-wrong-category (answers another category) | grant-slow (answers after 600 ms) | grant-no-origin (the list entries it writes have no origin field)
// FAKE_ADMIN_RULES_FILE: a JSON array of categories for "rules" (default: a short list with rm, git-push and two not bypassable ones).
// FAKE_ADMIN_RULES_CONFIG_ERROR: the text of config.error in the rules answer.
// Batch scenarios (tests of POST /guardrails/batch/*):
//   FAKE_ADMIN_UNIQUE_IDS=1: every grant gets its own id (c0ffee00 + its rank), so a revoke can name it.
//   FAKE_ADMIN_COUNTER_FILE + FAKE_ADMIN_ELEVATE_AFTER=n: the n first grants work, the next ones fail with elevation-required (the PIN token expired mid-batch).
//   FAKE_ADMIN_SPAM_SESSIONS=<id>,<id>: a grant for these sessions fails with the spam lock.
//   FAKE_ADMIN_GRANT_DELAY_MS=<ms> + FAKE_ADMIN_CONCURRENCY_FILE: a grant takes that long and writes "+" at its start and "-" at its end in the file (the test reads the peak).
//   FAKE_ADMIN_RULES_BY_CWD: a JSON file {"<basename of the cwd>": [categories]} for "rules"; a folder it does not list gets the default list.
// FAKE_ADMIN_LOG: when set, one JSON line per call is appended there: the argv, the text read on stdin (grant only) and whether the token is in any environment value.

const fs = require('fs');

const argv = process.argv.slice(2);
const sub = argv[1];
const cwd = argv.indexOf('--cwd') === -1 ? undefined : argv[argv.indexOf('--cwd') + 1];
const scenario = process.env.FAKE_ADMIN_SCENARIO || 'ok';

let stdinText = '';
if (argv[1] === 'grant') {
  try {
    stdinText = fs.readFileSync(0, 'utf8');
  } catch (e) {
    stdinText = '';
  }
}

if (process.env.FAKE_ADMIN_LOG) {
  const token = stdinText.trim();
  const tokenInEnv = token !== '' && Object.values(process.env).some((value) => String(value).includes(token));
  fs.appendFileSync(process.env.FAKE_ADMIN_LOG, JSON.stringify({ argv, stdin: stdinText, tokenInEnv }) + '\n');
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

const DEFAULT_RULES = [
  { name: 'rm', decision: 'deny', source: 'default', bypassable: true, hardcoded: false },
  { name: 'git-push', decision: 'ask', source: 'config', bypassable: true, hardcoded: false },
  { name: 'git-commit-push', decision: 'deny', source: 'default', bypassable: true, hardcoded: false },
  { name: 'ssh-config', decision: 'deny', source: 'hardcoded', bypassable: false, hardcoded: true },
  { name: 'secrets-leak', decision: 'deny', source: 'hardcoded', bypassable: false, hardcoded: true },
];

function withLock(run) {
  const lock = (process.env.FAKE_ADMIN_GRANTS_FILE || 'fake-admin') + '.lock';
  for (let i = 0; i < 2000; i += 1) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try {
    return run();
  } finally {
    try {
      fs.rmdirSync(lock);
    } catch (e) {
      // already gone
    }
  }
}

function rulesOf() {
  const byCwd = process.env.FAKE_ADMIN_RULES_BY_CWD;
  if (byCwd && cwd) {
    const table = JSON.parse(fs.readFileSync(byCwd, 'utf8'));
    const key = require('path').basename(cwd);
    if (table[key]) {
      return table[key];
    }
  }
  const file = process.env.FAKE_ADMIN_RULES_FILE;
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : DEFAULT_RULES;
}


function grant() {
  const token = stdinText.trim();
  const category = flag('category');
  const mode = flag('mode');
  const session = flag('session');
  const rationale = flag('rationale');
  const error = (text, code) => out({ schema: 'w-guardrails.error/1', error: text }, code === undefined ? 1 : code);
  if (scenario === 'grant-elevation') {
    return error('Verification failed: elevation-required. The PIN access token is older than 10 minutes or the PIN is locked.');
  }
  if (scenario === 'grant-pin-not-set') {
    return error('Verification failed: pin-not-set. No PIN is set in app-core.');
  }
  if (scenario === 'grant-unreachable') {
    return error('Verification failed: app-core is unreachable (stale port file: connect ECONNREFUSED 127.0.0.1:4850).');
  }
  if (scenario === 'grant-spam') {
    return error('Spam lock active: too many bypass requests for this session. Try again in 60 s.');
  }
  if (scenario === 'grant-not-bypassable') {
    return error(`Category "${category}" is not bypassable.`);
  }
  if (scenario === 'grant-echo-token') {
    return error(`Verification failed: the token ${token} was rejected.`);
  }
  if (process.env.FAKE_ADMIN_ELEVATE_AFTER !== undefined && process.env.FAKE_ADMIN_COUNTER_FILE) {
    fs.appendFileSync(process.env.FAKE_ADMIN_COUNTER_FILE, 'x');
    if (fs.statSync(process.env.FAKE_ADMIN_COUNTER_FILE).size > Number(process.env.FAKE_ADMIN_ELEVATE_AFTER)) {
      return error('Verification failed: elevation-required. The PIN access token is older than 10 minutes or the PIN is locked.');
    }
  }
  if ((process.env.FAKE_ADMIN_SPAM_SESSIONS || '').split(',').includes(session)) {
    return error('Spam lock active: too many bypass requests for this session. Try again in 60 s.');
  }
  if (token === '') {
    return error('No PIN access token on stdin. Pass the Bearer value on stdin.');
  }
  if (!category || !session || !rationale || !['once', '10m', '30m', '4h'].includes(mode)) {
    return error('Bad grant arguments.');
  }
  const concurrency = process.env.FAKE_ADMIN_CONCURRENCY_FILE;
  if (concurrency) {
    fs.appendFileSync(concurrency, '+');
  }
  const run = () => {
    if (concurrency) {
      fs.appendFileSync(concurrency, '-');
    }
    const entry = {
      id: 'c0ffee01',
      category,
      mode: mode === 'once' ? 'once' : 'ttl',
      session_id: session,
      expires: new Date(Date.now() + (mode === 'once' ? 600000 : mode === '10m' ? 600000 : mode === '30m' ? 1800000 : 14400000)).toISOString(),
      remaining_ms: mode === 'once' ? 600000 : mode === '10m' ? 600000 : mode === '30m' ? 1800000 : 14400000,
      uses_left: mode === 'once' ? 1 : null,
      reason: rationale,
    };
    if (scenario !== 'grant-no-origin') {
      entry.origin = 'ui';
    }
    if (process.env.FAKE_ADMIN_GRANTS_FILE) {
      withLock(() => {
        const known = grantsOf();
        if (process.env.FAKE_ADMIN_UNIQUE_IDS) {
          entry.id = (0xc0ffee00 + known.length + 1).toString(16);
        }
        fs.writeFileSync(process.env.FAKE_ADMIN_GRANTS_FILE, JSON.stringify([...known, entry]));
      });
    }
    out({ schema: 'w-guardrails.bypass-grant/1', granted: true, id: entry.id, category: scenario === 'grant-wrong-category' ? 'kill' : category, mode, session_id: session, expires: entry.expires, origin: 'ui' }, 0);
  };
  if (scenario === 'grant-slow' || process.env.FAKE_ADMIN_GRANT_DELAY_MS) {
    setTimeout(run, scenario === 'grant-slow' ? 600 : Number(process.env.FAKE_ADMIN_GRANT_DELAY_MS));
  } else {
    run();
  }
}

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
} else if (sub === 'grant') {
  grant();
} else if (argv[0] === 'rules') {
  const configError = process.env.FAKE_ADMIN_RULES_CONFIG_ERROR;
  out({ schema: 'w-guardrails.rules/1', cwd, config: { path: cwd + '/.claude/guardrails.json', present: Boolean(configError), error: configError || null }, categories: rulesOf() }, 0);
} else if (sub === 'revoke') {
  const id = flag('id');
  // the lookup and the rewrite share one lock: reading outside it while another revoke truncated the file made a known grant look unknown
  const found = scenario === 'revoke-fails' ? undefined : withLock(() => {
    const all = grantsOf();
    const hit = all.find((g) => g.id === id);
    if (hit) fs.writeFileSync(process.env.FAKE_ADMIN_GRANTS_FILE, JSON.stringify(all.filter((g) => g.id !== id)));
    return hit;
  });
  if (scenario === 'revoke-fails') {
    out({ schema: 'w-guardrails.error/1', error: 'Could not acquire the lock: another process is writing grants. Retry in a few seconds.' }, 1);
  } else if (!found) {
    out({ schema: 'w-guardrails.error/1', error: `No grant with id "${id}". Run "bypass list" to see current ids.` }, 1);
  } else {
    out({ schema: 'w-guardrails.bypass-revoke/1', revoked: true, id: scenario === 'revoke-mismatch' ? 'ffffffff' : id, category: found.category, session_id: found.session_id }, 0);
  }
} else {
  process.stderr.write('Unknown subcommand\n');
  process.exit(2);
}
