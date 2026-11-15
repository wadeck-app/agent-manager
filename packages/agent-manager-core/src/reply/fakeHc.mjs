// Test-only fake of herdr-core's `hc` (never the real one): the tests run it as `node fakeHc.mjs <hc arguments>`.
// FAKE_HC_SCENARIO: path of a JSON file {ls, get: {<address>: json}, send: {exit, stdout, delayMs}}. FAKE_HC_LOG: ndjson file that records every call
// (argv, whether HC_TERMINAL_ID was in the environment). It sends nothing anywhere.
import { appendFileSync, readFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync(process.env.FAKE_HC_SCENARIO, 'utf8'));
const args = process.argv.slice(2);
const separator = args.indexOf('--');
const positional = separator === -1 ? [] : args.slice(separator + 1);
appendFileSync(process.env.FAKE_HC_LOG, `${JSON.stringify({ argv: args, hasCallerId: Object.keys(process.env).some((name) => name.toUpperCase() === 'HC_TERMINAL_ID') })}\n`);

const print = (value, code = 0) => {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  process.exit(code);
};

if (args[0] === 'ls') {
  print(scenario.ls);
} else if (args[0] === 'get') {
  const answer = scenario.get?.[positional[0]];
  print(answer ?? { error: { kind: 'not_found', message: `no terminal "${positional[0]}"`, hint: 'see `hc ls --all`' } }, answer === undefined ? 3 : 0);
} else if (args[0] === 'send') {
  const send = scenario.send ?? { stdout: { started: true, status: 'idle', turn: 7 } };
  setTimeout(() => print(send.stdout, send.exit ?? 0), send.delayMs ?? 0);
} else {
  print({ error: { kind: 'usage', message: `unexpected arguments ${args.join(' ')}`, hint: '' } }, 2);
}
