// Test-only fake of herdr-core's `hc` for the approval tests (never the real one): `node fakeHcKeys.mjs <hc arguments>`.
// FAKE_HC_SCENARIO: JSON {ls, get: {<address>: json | [json, ...]}, afterKeys: {<address>: json}, read: {<address>: text}, keys: {exit, stdout, delayMs}}.
// A `get` list answers its entries in order (the last one repeats), so a test can make the terminal change between two reads. After the first
// `keys` call `afterKeys` answers instead. FAKE_HC_LOG: ndjson file with every call. FAKE_HC_STATE: a folder where the fake keeps its counters.
// It types nothing anywhere.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const scenario = JSON.parse(readFileSync(process.env.FAKE_HC_SCENARIO, 'utf8'));
const args = process.argv.slice(2);
const separator = args.indexOf('--');
const positional = separator === -1 ? [] : args.slice(separator + 1);
appendFileSync(process.env.FAKE_HC_LOG, `${JSON.stringify({ argv: args })}\n`);
const keysFlag = join(process.env.FAKE_HC_STATE, 'keys-called');
const counterFile = (address) => join(process.env.FAKE_HC_STATE, `get-${address}`);

const print = (value, code = 0) => {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  process.exit(code);
};
const notFound = (address) => print({ error: { kind: 'not_found', message: `no terminal "${address}"`, hint: 'see `hc ls --all`' } }, 3);

if (args[0] === 'ls') {
  print(scenario.ls);
} else if (args[0] === 'get') {
  const address = positional[0];
  let answer = existsSync(keysFlag) && scenario.afterKeys?.[address] !== undefined ? scenario.afterKeys[address] : scenario.get?.[address];
  if (Array.isArray(answer)) {
    const file = counterFile(address);
    const count = existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0;
    writeFileSync(file, String(count + 1));
    answer = answer[Math.min(count, answer.length - 1)];
  }
  if (answer === undefined) {
    notFound(address);
  }
  if (answer.fail === true) {
    print({ error: { kind: 'internal', message: 'hc is busy', hint: 'retry' } }, 1);
  }
  print(answer);
} else if (args[0] === 'read') {
  const text = scenario.read?.[positional[0]];
  if (text === undefined) {
    notFound(positional[0]);
  }
  print({ complete: true, how: 'screen', text });
} else if (args[0] === 'keys') {
  const keys = scenario.keys ?? { stdout: { status: 'blocked', turn: 1 } };
  if ((keys.exit ?? 0) === 0) {
    writeFileSync(keysFlag, '1');
  }
  setTimeout(() => print(keys.stdout, keys.exit ?? 0), keys.delayMs ?? 0);
} else {
  print({ error: { kind: 'usage', message: `unexpected arguments ${args.join(' ')}`, hint: '' } }, 2);
}
