// Test-only program that prints what hcRunner must cope with.
//   split      one two-byte character (U+00E9) cut between two writes
//   big-bytes  2.4 MB made of two-byte characters (1.2 million characters), then stays alive (the runner must stop it)
//   hang       prints nothing and stays alive (the runner must time out)
const mode = process.argv[2];
if (mode === 'split') {
  process.stdout.write(Buffer.from([0x7b, 0xc3]));
  setTimeout(() => process.stdout.write(Buffer.from([0xa9, 0x7d, 0x0a])), 50);
} else if (mode === 'big-bytes') {
  process.stdout.write('\u00e9'.repeat(1_200_000));
  setTimeout(() => undefined, 60_000);
} else if (mode === 'hang') {
  setTimeout(() => undefined, 60_000);
} else {
  process.stderr.write(`unknown mode ${mode}\n`);
  process.exit(2);
}
