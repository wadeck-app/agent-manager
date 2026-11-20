// Test-only fake of herdr-core's `hc` for the launcher (never the real one): the tests run it as `node fakeHcRun.mjs <hc arguments>`.
// FAKE_HC_SCENARIO: path of a JSON file {run: {exit, stdout, delayMs}, get: {<address>: [answer, ...]}} where each `hc get` of an address takes the next
// answer of its list (the last one repeats). An answer is an object (exit 0) or {plain, exit} (plain text, nonzero exit). FAKE_HC_LOG: ndjson file that records every call
// (argv, whether HC_TERMINAL_ID was in the environment). It starts no terminal and sends nothing anywhere.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync(process.env.FAKE_HC_SCENARIO, 'utf8'));
const args = process.argv.slice(2);
const separator = args.indexOf('--');
const positional = separator === -1 ? [] : args.slice(separator + 1);
const previous = existsSync(process.env.FAKE_HC_LOG) ? readFileSync(process.env.FAKE_HC_LOG, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
appendFileSync(process.env.FAKE_HC_LOG, `${JSON.stringify({ argv: args, hasCallerId: Object.keys(process.env).some((name) => name.toUpperCase() === 'HC_TERMINAL_ID') })}\n`);

const print = (value, code = 0) => {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  process.exit(code);
};

if (args[0] === 'run') {
  const run = scenario.run ?? { stdout: { address: 't9', agent: 'claude', name: 'x', state: 'live', turn: 0 } };
  setTimeout(() => print(run.stdout, run.exit ?? 0), run.delayMs ?? 0);
} else if (args[0] === 'get') {
  const address = positional[0];
  const answers = scenario.get?.[address];
  if (answers === undefined) {
    print({ error: { kind: 'not_found', message: `no terminal "${address}"`, hint: 'see `hc ls --all`' } }, 3);
  } else {
    const calls = previous.filter((entry) => entry.argv[0] === 'get' && entry.argv.at(-1) === address).length;
    const answer = answers[Math.min(calls, answers.length - 1)];
    if (answer.plain !== undefined) {
      print(answer.plain, answer.exit ?? 1);
    } else if (answer.error !== undefined) {
      print(answer, answer.exit ?? 3);
    } else {
      print(answer, 0);
    }
  }
} else {
  print({ error: { kind: 'usage', message: `unexpected arguments ${args.join(' ')}`, hint: '' } }, 2);
}
