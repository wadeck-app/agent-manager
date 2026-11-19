// Prints a raw slice of the installed binary (latin1) from offset for N chars, non-printables as dots.
import fs from 'node:fs';
const [file, off, len = '1500'] = process.argv.slice(2);
if (!file || off === undefined) throw new Error('usage: node bin-slice.mjs <file> <offset> [len]');
const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(+len);
fs.readSync(fd, b, 0, +len, +off); console.log(b.toString('latin1').replace(/[^\x20-\x7e\n]/g, '.'));
