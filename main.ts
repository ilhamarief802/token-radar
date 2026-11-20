// main.ts — the token radar's entrypoint. Node 22, TypeScript stripped, standard library only.
//
//   mkdir -p out
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json
//
// What one run does, in order:
//   1. read the sealed snapshot (--input <file|directory|snapshot.json>, or /input by default)
//   2. score it with lib/model.ts and refuse a board the gate's rules reject
//   3. write board.json (the ranked rows) and data.js (the same board, shaped for the page)
//   4. copy dashboard/ and screenshots/ into the output directory, checking the shots the gate wants
//   5. write dossier.json last: the judge rebuilds it from the output directory and compares bytes
//
// Nothing here reaches the network. Out of the grader's container, MAKEFUN_OUTPUT_DIR stands in
// for /output, and --output overrides both.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardFault, computeRadar, radarScript, readSnapshot } from './lib/model.ts';
import type { MarketSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** This repository's own directory: the page and the screenshots are copied from beside main.ts. */
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps (reference/gate.json): the text cap shapes the dossier, the others only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };

/** A screenshot the gate accepts: a letter, digit or underscore first, then letters, digits, . _ -. */
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Hand in at least this many: the board, a detail view and a filtered view. */
const SCREENSHOTS_NEEDED = 3;

/** `--name <value>` or `--name=<value>` from the command line, else `fallback`. */
function flagValue(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const inline = process.argv.find((argument) => argument.startsWith(`${flag}=`));
  return inline === undefined ? fallback : inline.slice(flag.length + 1);
}

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const inputArg = flagValue('input', '/input');
const snapshotFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotFile)) {
  fail(`token radar: no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outputDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot: MarketSnapshot;
try {
  snapshot = readSnapshot(readFileSync(snapshotFile, 'utf8'));
} catch (err) {
  fail(`token radar: ${(err as Error).message}`, 1);
}
const { board, radar } = computeRadar(snapshot);
const fault = boardFault(board, snapshot);
if (fault !== null) fail(`token radar: the model wrote a board the gate refuses: ${fault}`, 1);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), radarScript(radar));

/** Copy one directory's regular files into `to`, skipping dot-files; return the names copied. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyDirectory(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
const shots = copyDirectory(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (shots.length < SCREENSHOTS_NEEDED) {
  fail(
    `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`,
    1,
  );
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }
}

// The dossier is written last: the scorer rebuilds it from this output directory, byte for byte.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outputDir, 'board.json')}, ${join(outputDir, 'data.js')}, ${join(outputDir, 'dashboard')} (3 files), ${join(outputDir, 'screenshots')} (${shots.length} images) and ${join(outputDir, 'dossier.json')}\n`,
);
