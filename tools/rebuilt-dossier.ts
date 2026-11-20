import { buildDossier } from '/home/ilham/makefun-work/radar/entry/vendor/makefun-board.ts';
import { writeFileSync } from 'node:fs';
const out = '/home/ilham/makefun-work/radar/entry/out';
const d = buildDossier(out, { text_max_bytes: 65536 });
writeFileSync('/tmp/dossier.rebuilt.json', d);
console.log('rebuilt bytes', Buffer.byteLength(d));
