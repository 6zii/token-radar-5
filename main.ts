// Token Radar, radar-5: read the sealed snapshot, fit the size
// curve on the clean live peers, rank every clean pre-token
// protocol by implied value, and write the board, the dashboard's
// data, the dashboard, the screenshots and the dossier.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts \
//     --input ../input/snapshot.json
//
// The program is deterministic: the same snapshot always writes the
// same bytes, because every sort has a slug tie-break and no clock,
// random number or network is read. It runs in a fresh container with
// no network, a read-only repository and a writable /output.
//
// What it writes, and in what order: board.json first (the ranked
// board), then data.js (the dashboard's data), then the dashboard
// and the screenshots copied in as they stand, then dossier.json,
// which is built last because it hashes everything else. Nothing is
// written at all when the board fails its own gate.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// Caps the dossier enforces on its own text and screenshots, and the
// file-name rule the screenshots must pass.
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// A complaint on stderr and an exit code, never a half-written board.
function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

// One flag, two spellings: --input <path> or --input=<path>. A flag
// left with no value falls back to its default, so a stray --input
// at the end of the line cannot eat the next flag.
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, data: radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot, radar);
if (issue !== null) {
  fail(`the model wrote a board the gate refuses: ${issue}`, 1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

// Copy a directory flat: every plain file in it, nothing nested and
// nothing hidden. The dashboard and the screenshots are both flat
// directories, and a nested file would be a surprise, not an asset.
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  // Sorted, so the copy order is the directory's, not the filesystem's.
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

// The run's own summary: the fit, the held-out tests and the top
// rows with their odds and verdicts, so a log reader sees the model
// without opening the dashboard.
const top = board.slice(0, 5).map((r) => `${r.rank}. ${r.slug} $${r.implied_value_usd.toLocaleString('en-US')} (odds ${r.token_odds.toFixed(2)}, rank ${r.rank_low}-${r.rank_high}, ${r.farm.verdict})`).join(', ');
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: model "${radar.held_out.chosen_name}": log(mcap) = ${radar.fit.intercept.toFixed(4)} + ${radar.fit.slope.toFixed(4)} log(TVL) over ${radar.fit.peers} clean live peers; held-out miss ${radar.held_out.loo_median_factor.toFixed(2)}x (leave-one-out) and ${radar.held_out.wf_median_factor.toFixed(2)}x (walk-forward)\n` +
    `token radar: token odds by age bucket x category group, shrunk ${radar.model.odds_shrink}; leave-one-out Brier cell ${radar.odds.brier_cell.toFixed(4)}, buckets ${radar.odds.brier_buckets.toFixed(4)}, constant ${radar.odds.brier_constant.toFixed(4)}, logistic ${radar.odds.brier_logistic.toFixed(4)}; walk-forward cell ${radar.odds.wf_brier_cell.toFixed(4)}, buckets ${radar.odds.wf_brier_buckets.toFixed(4)}, constant ${radar.odds.wf_brier_constant.toFixed(4)}, logistic ${radar.odds.wf_brier_logistic.toFixed(4)}\n` +
    `token radar: farm verdicts at $${radar.model.ticket_usd} and ${Math.round(radar.model.airdrop_share * 100)}%: ${radar.farm_counts.farm} FARM, ${radar.farm_counts.thin} THIN, ${radar.farm_counts.skip} SKIP of ${board.length} rows; bootstrap rank ranges median width ${radar.bootstrap_median_range}, widest ${radar.bootstrap_max_range}; seal ${radar.seal}\n` +
    `token radar: top rows: ${top}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
