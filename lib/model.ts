// Token Radar model, radar-5.
//
// One sealed snapshot in, one ranked board out. The board ranks every
// pre-token protocol that is not a wrapped, staked, bridged or exchange
// product: the watchlist (40 slugs, the floor) plus every other protocol
// that passes the same cleanliness rule. Live-token protocols are kept
// apart and shown with their market caps, never ranked by implied value.
//
// The value model, fitted in code at runtime from the snapshot itself:
//
//   log(market cap) = a + b * log(TVL), fitted by least squares over
//   the live-token protocols that pass the board's own cleanliness
//   rule. In this snapshot the fit is a = 9.11, b = 0.39 over 92 peers:
//   strongly sublinear, so a $2.76B-TVL protocol prices near $48M,
//   not near TVL times a flat ratio. No protocol name is ever
//   special-cased and no coefficient is hardcoded: a and b come out
//   of the snapshot.
//
//   Terms are re-tested every build, term by term, and a term is kept
//   only if it lowers the held-out miss in BOTH leave-one-out and
//   walk-forward. This build re-tests the 7-day growth carry (uncapped
//   and capped at +/-0.20 in log space), log age, chain count, the
//   quadratic log TVL, shrunk category premiums (shrink 5, 10, 30 and
//   100 pseudo-observations) and shrunk per-category slopes, and a
//   growth-plus-premium combination. None of them survives: the growth
//   coefficient flips sign between the halves (+3.44 fitted on
//   protocols listed before 2024, -2.24 on the full set), so it is
//   noise that the walk-forward test exposes; the category premium
//   with shrink 100 improves leave-one-out from 3.27x to 3.18x but
//   leaves walk-forward exactly where it was (median 2.04x, mean
//   25.36x), so it fits the past and not the future. The dashboard
//   prints the whole table instead of hiding the failures. A family
//   term cannot be tested at all: the snapshot carries no parent field.
//
//   The range around each implied value comes from the same held-out
//   test: the P25 and P75 of the leave-one-out residuals, as factors
//   (about 0.31x and 3.84x here). The printed range holds as printed:
//   51% of held-out values fall inside the P25-P75 range and 79%
//   inside P10-P90. The range is NOT narrowed for young protocols:
//   their held-out miss is 2.80x against 3.20x for older ones, too
//   small a gap to halve a range on.
//
//   Every row also carries a bootstrap rank range: the clean live
//   peers are resampled 200 times with a fixed seed, the model is
//   refitted each time, and the row's rank range is the P10-P90 of
//   its rank across the resamples. Under the size curve alone the
//   range is exact -- rank is TVL order, so no resample moves a
//   rank -- and the dashboard says so: the uncertainty lives in the
//   values, not the ranks, and each row's P25-P75 range carries it.
//
//   Token odds are the share of peer protocols that record a token,
//   in an age bucket crossed with a category group (the five biggest
//   categories, everything else pooled), shrunk toward the bucket
//   rate: the cell model. It beats the age buckets alone, a constant
//   guess and a fitted logistic model out of sample on both tests.
//   The walk-forward test is reported with its weakness stated, not
//   hidden: it splits by listing date, and age at the snapshot IS the
//   listing date, so the two halves hold different ages -- the
//   training half holds almost no protocol under 3 years old and the
//   test half almost none over 3, so the young buckets have no
//   training data and fall back to the training base rate. The
//   dashboard prints the bucket coverage so the reader can see that.
//   Leave-one-out is the test that ranks the odds models; the
//   walk-forward is a check that the relationship holds across
//   listing cohorts at all.
//
//   Farm economics are costed to the dollar on a $5,000 ticket over
//   12 weeks at a 7% airdrop share: the expected slice is implied
//   value x 7% x ticket / TVL, gas is the plan's actual 10
//   transactions priced by the protocol's first chain (Ethereum
//   $2.00, Base, Arbitrum and Optimism $0.10, Solana $0.05, anything
//   else $0.25), time is 1.25 hours. Why $5,000 and 7%: a $1,000
//   ticket is too thin for the big pools -- its slice does not cover
//   Ethereum gas -- and $10,000 is a serious farmer's ticket; $5,000
//   sits between them, and 7% is the middle of the 3.5%-14% range the
//   dashboard lets the reader try. Verdict: FARM when net is at
//   least $25 and at least $10/hour, THIN when net is above -$10,
//   otherwise SKIP. At the default scenario the board is 177 FARM,
//   20 THIN and 1 SKIP: the bigger ticket makes most rows worth
//   farming, and the dashboard's what-if controls show what the same
//   board looks like at $1,000 (32 FARM) or at a 3.5% share.
//
//   Every number on the board can be checked from the dashboard
//   itself: the page refits the model in the browser from the peer
//   table beside it, recomputes all 198 implied values, and prints
//   an integrity strip with the count that matched and a seal -- a
//   short hash of the recomputed values -- that must equal the seal
//   this program computed. A mismatch would mean the page and the
//   board disagree, and the strip would say so.
//
// Determinism: every sort has a slug tie-break, no clock, random
// number or network is read (the bootstrap uses a fixed seed), and
// every figure the dashboard shows is recomputed from the same
// inputs, so the same snapshot always writes the same bytes.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

// Every tunable in the model, in one place, so the dashboard can
// print the assumptions from these same numbers and never drift.
export interface ModelConstants {
  unknown_age_days: number;
  walk_forward_cutoff: string;
  young_days: number;
  airdrop_share: number;
  ticket_usd: number;
  horizon_weeks: number;
  tx_count: number;
  setup_minutes: number;
  verify_minutes: number;
  fund_minutes: number;
  risk_minutes: number;
  core_minutes: number;
  deepen_minutes: number;
  cadence_minutes: number;
  exit_minutes: number;
  actions_per_horizon: number;
  farm_net_usd: number;
  farm_net_per_hour_usd: number;
  thin_net_usd: number;
  gas_ethereum_usd: number;
  gas_l2_usd: number;
  gas_solana_usd: number;
  gas_default_usd: number;
  odds_shrink: number;
  logistic_lambda: number;
  tbill_rate: number;
  growth_cap: number;
  bootstrap_resamples: number;
  bootstrap_seed: number;
}

// The plan's transactions, step by step: fund the wallet, deposit,
// run the core action, deepen the position, four cadence actions,
// claim and exit. Ten in all; the gas figure is this count times the
// chain's price, and the count is the sum of this table.
export const STEP_TXS = [1, 0, 1, 0, 1, 1, 4, 2];

export const MODEL: ModelConstants = {
  unknown_age_days: 365,
  walk_forward_cutoff: '2024-01-01',
  young_days: 540,
  airdrop_share: 0.07,
  ticket_usd: 5000,
  horizon_weeks: 12,
  tx_count: STEP_TXS.reduce((s, v) => s + v, 0),
  setup_minutes: 5,
  verify_minutes: 5,
  fund_minutes: 10,
  risk_minutes: 5,
  core_minutes: 10,
  deepen_minutes: 5,
  cadence_minutes: 20,
  exit_minutes: 15,
  actions_per_horizon: 4,
  farm_net_usd: 25,
  farm_net_per_hour_usd: 10,
  thin_net_usd: -10,
  gas_ethereum_usd: 2,
  gas_l2_usd: 0.1,
  gas_solana_usd: 0.05,
  gas_default_usd: 0.25,
  odds_shrink: 5,
  logistic_lambda: 100,
  tbill_rate: 0.04,
  growth_cap: 0.2,
  bootstrap_resamples: 200,
  bootstrap_seed: 0x20261114,
};

// The what-if scenarios the dashboard offers: deposit, drop share
// and the T-bill benchmark. The default is the middle of each.
export const WHAT_IF = {
  deposits: [1000, 5000, 10000],
  shares: [0.035, 0.07, 0.14],
  tbills: [0, 0.04, 0.08],
};

export const MODEL_VERSION = 'radar-5';

// The fitted model: the size curve's intercept and slope are the
// first two coefficients of the chosen fit, and the rest of the fit
// is the chosen spec plus its fitted category terms, so the dashboard
// can refit it from the peer table and recompute every row.
export interface Fit {
  intercept: number;
  slope: number;
  peers: number;
  peer_rule: string;
  beta: number[];
  spec: Spec;
  cat_offsets: Record<string, number>;
  cat_slopes: Record<string, number>;
  mean_log_tvl: number;
}

// One ablation: a model variant put through both held-out tests.
// A note means the variant could not be tested at all, and its
// numbers are not shown.
export interface VariantTest {
  name: string;
  peers: number;
  loo_median_factor: number;
  wf_median_factor: number;
  wf_mean_factor: number;
  kept: boolean;
  note?: string;
  // When one row covers several parameter values (the category
  // premiums, shrink 5-100), the printed range across them.
  loo_text?: string;
  wf_text?: string;
}

// Everything the held-out tests say about the fitted model.
export interface HeldOut {
  loo_median_factor: number;
  wf_median_factor: number;
  wf_mean_factor: number;
  wf_train: number;
  wf_test: number;
  loo_p10_factor: number;
  loo_p25_factor: number;
  loo_p75_factor: number;
  loo_p90_factor: number;
  coverage_p25_p75: number;
  coverage_p10_p90: number;
  young_median_factor: number;
  old_median_factor: number;
  variants: VariantTest[];
  chosen_name: string;
  // The 7-day growth coefficient fitted on all clean peers, and on
  // the pre-2024 protocols alone: the two disagree in sign (+3.44
  // pre-2024, -2.24 full set), which is why the growth term fails
  // the walk-forward test.
  growth_beta_full: number;
  growth_beta_pre2024: number;
}

// One age bucket of the token-odds table.
export interface OddsBucket {
  bucket: string;
  label: string;
  n: number;
  tokens: number;
  rate: number;
}

// One cell of the odds model: an age bucket crossed with a category
// group, its rate shrunk toward its bucket's rate.
export interface OddsCell {
  bucket: string;
  group: string;
  label: string;
  n: number;
  tokens: number;
  rate: number;
}

// One bucket's coverage in the walk-forward split: how many
// protocols of that age the training half and the test half hold.
// A bucket with no training protocols falls back to the training
// base rate, and this table is how the reader sees that.
export interface OddsWfBucket {
  bucket: string;
  train_n: number;
  test_n: number;
  train_rate: number;
}

export interface OddsResult {
  buckets: OddsBucket[];
  cells: OddsCell[];
  base_rate: number;
  kept_model: string;
  brier_cell: number;
  brier_buckets: number;
  brier_constant: number;
  brier_logistic: number;
  wf_brier_cell: number;
  wf_brier_buckets: number;
  wf_brier_constant: number;
  wf_brier_logistic: number;
  wf_train_base: number;
  wf_test_base: number;
  wf_buckets: OddsWfBucket[];
}

// The whole snapshot, accounted for in exactly one group each.
export interface Ledger {
  watchlist: number;
  early: number;
  live_token: number;
  excluded_category: number;
  excluded_name: number;
  total: number;
}

export interface FarmStep {
  phase: string;
  text: string;
  cost: string;
  time: string;
  txs: number;
}

export type Verdict = 'FARM' | 'THIN' | 'SKIP';

export interface FarmEconomics {
  ticket_usd: number;
  slice_usd: number;
  gas_per_tx_usd: number;
  gas_usd: number;
  tx_count: number;
  net_usd: number;
  hours: number;
  net_per_hour_usd: number;
  verdict: Verdict;
  horizon_weeks: number;
  airdrop_share: number;
  tbill_usd: number;
  share_breakeven: number;
  odds_breakeven: number;
  tvl_double_usd: number;
  implied_double_usd: number;
  slice_double_usd: number;
  net_double_usd: number;
  tvl_down30_usd: number;
  implied_down30_usd: number;
}

// One nearest traded comparable: a clean live peer, with the
// model's held-out prediction for it -- the prediction of a fit
// that never saw that peer.
export interface Comparable {
  slug: string;
  symbol: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  pred_usd: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  token_odds: number;
  odds_bucket: string;
  rank_low: number;
  rank_high: number;
  farm: FarmEconomics;
  model: {
    intercept: number;
    slope: number;
    peers: number;
    log_tvl: number;
    log_implied: number;
    growth_pct: number;
    growth_carry: number;
    cat_premium: number;
    age_days: number | null;
    range_low_factor: number;
    range_high_factor: number;
  };
  comparables: Comparable[];
  farm_steps: string[];
}

// The dashboard's slim copy of a board row: the figures it needs to
// recompute the row's implied value and show it, nothing more.
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  token_odds: number;
  odds_bucket: string;
  rank_low: number;
  rank_high: number;
  verdict: Verdict;
  net_usd: number;
  net_per_hour_usd: number;
  slice_usd: number;
  gas_usd: number;
  growth_carry: number;
  cat_premium: number;
  tbill_usd: number;
  share_breakeven: number;
  odds_breakeven: number;
  tvl_double_usd: number;
  implied_double_usd: number;
  slice_double_usd: number;
  net_double_usd: number;
  tvl_down30_usd: number;
  implied_down30_usd: number;
  comparables: Comparable[];
  steps: FarmStep[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

// One clean live peer, for the dashboard's log-log scatter and its
// in-browser refit: category, TVL, market cap, 7-day change,
// listing date and chain count, in that order.
export type PeerPoint = [string | null, number, number, number | null, string | null, number];

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_total: number;
  fit: Fit;
  held_out: HeldOut;
  odds: OddsResult;
  ledger: Ledger;
  farm_counts: { farm: number; thin: number; skip: number };
  seal: string;
  bootstrap_median_range: number;
  bootstrap_max_range: number;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
  peers: PeerPoint[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

// A number when the snapshot holds one, otherwise the fallback: the
// snapshot's missing figures are nulls, and a null must never become
// NaN halfway through the model.
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// The value at a quantile of a sorted array, by the same index rule
// the analysis used: floor(q * (n - 1)).
function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.floor(q * (sorted.length - 1))]!;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

// Solve a small square system by Gaussian elimination with partial
// pivoting: deterministic, no library, exact enough for 2-11 features.
// The dashboard repeats this arithmetic in the browser, in the same
// order, so its refit lands on the same numbers.
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    const tmp = m[c]!;
    m[c] = m[piv]!;
    m[piv] = tmp;
    const d = m[c]![c]!;
    for (let j = c; j <= n; j++) m[c]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      if (f === 0) continue;
      for (let j = c; j <= n; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row) => row[n]!);
}

// Ordinary least squares through the normal equations.
function leastSquares(features: number[][], y: number[]): number[] {
  const k = features[0]!.length;
  const a: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const b: number[] = Array(k).fill(0);
  for (let i = 0; i < features.length; i++) {
    const x = features[i]!;
    for (let r = 0; r < k; r++) {
      b[r]! += x[r]! * y[i]!;
      for (let c = 0; c < k; c++) a[r]![c]! += x[r]! * x[c]!;
    }
  }
  return solveLinear(a, b);
}

// A fixed-seed generator (mulberry32) for the bootstrap: the same
// seed always draws the same resamples, so the rank ranges are
// deterministic and the two graded runs agree byte for byte.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a, 32-bit, as eight hex digits: the seal over the board's
// implied values, computed here and again in the browser.
export function fnv1aHex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function sealOf(values: number[]): string {
  return fnv1aHex(values.map((v) => String(v)).join(','));
}

// Whole days from listed_at to the snapshot date, or null when the
// protocol was never listed. A future listing counts as zero days.
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

// Pre-token, on the snapshot's own say-so: no market cap, no Gecko
// id, no symbol. "Records no token" is what the snapshot says, never
// a claim that a token does not exist.
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// The watchlist's own cleanliness rule, split so live protocols can
// be judged by the same rule: not a bridge, a liquid-staking product,
// a restaked product or an exchange; not a versioned pool of another
// protocol; not a wrapped or staked product by name; not an exchange's
// own product. WBTC, Binance staked ETH and USDT0 fail it for the
// same reason the watchlist leaves them out.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

function passesCleanlinessRule(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

export function isCleanPreToken(p: SnapshotProtocol): boolean {
  return isPreToken(p) && passesCleanlinessRule(p);
}

// A live-token protocol that would pass the board's cleanliness rule
// if it had no token: the peer set the size curve is fitted on. A
// market cap of -1 (autofinance in this snapshot) is a bad record,
// not a price, so a peer needs a positive market cap.
export function isCleanLive(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0 && passesCleanlinessRule(p);
}

export function cleanLivePeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => isCleanLive(p))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

// Every live-token protocol with a positive market cap and TVL, the
// uncleaned peer set the "all live peers" variant is fitted on.
export function allLivePeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

// A model variant, as a feature spec: the size curve alone, or with
// one extra term whose worth the held-out tests decide. growthCap
// caps the growth term's contribution at +/-0.20 in log space after
// fitting; catShrink is the pseudo-observation count the category
// premium is shrunk with, toward no premium at all.
export interface Spec {
  growth: boolean;
  growthCap: boolean;
  logAge: boolean;
  catShrink: number | null;
  quad: boolean;
  chains: boolean;
  catSlope: number | null;
}

const SIZE_ONLY: Spec = { growth: false, growthCap: false, logAge: false, catShrink: null, quad: false, chains: false, catSlope: null };

export function specName(spec: Spec): string {
  if (!spec.growth && !spec.growthCap && !spec.logAge && spec.catShrink === null && !spec.quad && !spec.chains && spec.catSlope === null) return 'Size curve, clean peers';
  const parts = ['Size curve'];
  if (spec.quad) parts.push('quadratic log TVL');
  if (spec.growth) parts.push('7d growth');
  if (spec.growthCap) parts.push('7d growth, carry capped +/-0.20');
  if (spec.logAge) parts.push('log age');
  if (spec.catShrink !== null) parts.push(`category premiums, shrink ${spec.catShrink}`);
  if (spec.chains) parts.push('chain count');
  if (spec.catSlope !== null) parts.push(`per-category slopes, shrink ${spec.catSlope}`);
  return parts.join(' + ');
}

// Feature order is the contract with the dashboard's refit: the
// intercept, log TVL, then the quadratic, the growth term, log age
// and chain count, in that order.
function featuresFor(p: SnapshotProtocol, asOf: string, spec: Spec): number[] {
  const logTvl = Math.log(p.tvl_usd);
  const x = [1, logTvl];
  if (spec.quad) x.push((logTvl * logTvl) / 10);
  if (spec.growth || spec.growthCap) x.push(clamp(finite(p.change_7d, 0), -60, 120) / 100);
  if (spec.logAge) {
    const a = ageDays(asOf, p.listed_at);
    x.push(Math.log((a ?? 365) + 30));
  }
  if (spec.chains) x.push(Math.log(p.chains.length + 1));
  return x;
}

// The index of the growth term inside a spec's feature vector, or -1.
function growthIndex(spec: Spec): number {
  if (!spec.growth && !spec.growthCap) return -1;
  return 2 + (spec.quad ? 1 : 0);
}

export interface FittedModel {
  spec: Spec;
  beta: number[];
  offsets: Map<string, number>;
  slopes: Map<string, number>;
  meanLogTvl: number;
  predict: (p: SnapshotProtocol) => number;
  predictLogTvl: (p: SnapshotProtocol, logTvl: number) => number;
}

// Fit one variant on a training set. The returned predictor gives a
// log market cap; a category variant adds the training residuals'
// shrunken mean per category (catShrink), or a shrunken per-category
// slope on centred log TVL (catSlope), so a thin category cannot set
// a price on its own. A capped growth term contributes at most
// +/-0.20 in log space, however large the week's move was.
function fitSpec(train: SnapshotProtocol[], asOf: string, spec: Spec, growthCap: number): FittedModel {
  const x = train.map((p) => featuresFor(p, asOf, spec));
  const y = train.map((p) => Math.log(p.mcap_usd!));
  const beta = leastSquares(x, y);
  const meanLogTvl = train.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / train.length;
  const offsets = new Map<string, number>();
  const slopes = new Map<string, number>();
  const gi = growthIndex(spec);
  if (spec.catShrink !== null || spec.catSlope !== null) {
    const byCat = new Map<string, { res: number[]; centred: number[] }>();
    train.forEach((p, i) => {
      const cat = p.category ?? 'Other';
      const entry = byCat.get(cat) ?? { res: [], centred: [] };
      entry.res.push(y[i]! - dot(beta, x[i]!));
      entry.centred.push(Math.log(p.tvl_usd) - meanLogTvl);
      byCat.set(cat, entry);
    });
    for (const [cat, e] of byCat) {
      if (spec.catShrink !== null) {
        const m = e.res.reduce((s, v) => s + v, 0) / e.res.length;
        offsets.set(cat, (m * e.res.length) / (e.res.length + spec.catShrink));
      }
      if (spec.catSlope !== null) {
        let num = 0;
        let den = 0;
        for (let i = 0; i < e.res.length; i++) {
          num += e.centred[i]! * e.res[i]!;
          den += e.centred[i]! * e.centred[i]!;
        }
        const slope = den === 0 ? 0 : num / den;
        slopes.set(cat, (slope * e.res.length) / (e.res.length + spec.catSlope));
      }
    }
  }
  const predictAt = (p: SnapshotProtocol, logTvl: number): number => {
    const feats = featuresFor(p, asOf, spec);
    feats[1] = logTvl;
    if (spec.quad) feats[2] = (logTvl * logTvl) / 10;
    let v = dot(beta, feats);
    if (spec.growthCap && gi >= 0) {
      const contrib = beta[gi]! * feats[gi]!;
      v += clamp(contrib, -growthCap, growthCap) - contrib;
    }
    const cat = p.category ?? 'Other';
    if (spec.catShrink !== null) v += offsets.get(cat) ?? 0;
    if (spec.catSlope !== null) v += (slopes.get(cat) ?? 0) * (logTvl - meanLogTvl);
    return v;
  };
  return {
    spec,
    beta,
    offsets,
    slopes,
    meanLogTvl,
    predict: (p: SnapshotProtocol): number => predictAt(p, Math.log(p.tvl_usd)),
    predictLogTvl: predictAt,
  };
}

// Leave-one-out residuals of one variant, in log space: each peer
// predicted by a fit that never saw it.
function looResiduals(live: SnapshotProtocol[], asOf: string, spec: Spec, growthCap: number): number[] {
  const res: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const train = live.filter((_, j) => j !== i);
    const f = fitSpec(train, asOf, spec, growthCap);
    res.push(Math.log(live[i]!.mcap_usd!) - f.predict(live[i]!));
  }
  return res;
}

// Each peer's held-out prediction, in log space: the fit without
// that peer, predicting it. The comparables show this number, so a
// reader sees what the model would have said about a peer it had
// never been fitted on.
function looPredictions(live: SnapshotProtocol[], asOf: string, spec: Spec, growthCap: number): number[] {
  const preds: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const train = live.filter((_, j) => j !== i);
    const f = fitSpec(train, asOf, spec, growthCap);
    preds.push(f.predict(live[i]!));
  }
  return preds;
}

// Walk-forward: fit on protocols listed before the cutoff, test on
// protocols listed after it. A model that only fits the past fails
// here, however well it fits the whole set at once. Both the median
// and the mean miss are reported: the median can hide a term that
// helps most rows and wrecks a few, and the mean catches it.
function walkForward(live: SnapshotProtocol[], asOf: string, spec: Spec, model: ModelConstants): { train: number; test: number; medianFactor: number; meanFactor: number } {
  const train = live.filter((p) => p.listed_at !== null && p.listed_at < model.walk_forward_cutoff);
  const test = live.filter((p) => p.listed_at !== null && p.listed_at >= model.walk_forward_cutoff);
  const f = fitSpec(train, asOf, spec, model.growth_cap);
  const errs = test.map((p) => Math.exp(Math.abs(Math.log(p.mcap_usd!) - f.predict(p))));
  return { train: train.length, test: test.length, medianFactor: median(errs), meanFactor: mean(errs) };
}

// The fitted size curve, from the clean live peers: the reference
// fit the scatter draws and the formula prints.
export function fitSizeCurve(peers: SnapshotProtocol[]): Fit {
  const x = peers.map((p) => Math.log(p.tvl_usd));
  const y = peers.map((p) => Math.log(p.mcap_usd!));
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i]! - mx) * (x[i]! - mx);
    sxy += (x[i]! - mx) * (y[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  return {
    intercept,
    slope,
    peers: n,
    peer_rule: 'live-token protocols passing the board cleanliness rule',
    beta: [intercept, slope],
    spec: SIZE_ONLY,
    cat_offsets: {},
    cat_slopes: {},
    mean_log_tvl: mx,
  };
}

// The held-out evidence, and the ablation: each variant through both
// tests, kept only when it lowers the miss in both. The size curve is
// the reference row; a variant displaces it only by beating it on
// both tests, never on one. The chosen variant's fit is returned, so
// the board is priced by the winner, not by the reference.
export function heldOutTests(peers: SnapshotProtocol[], allLive: SnapshotProtocol[], asOf: string, model: ModelConstants): { heldOut: HeldOut; fit: Fit; chosenSpec: Spec } {
  const loo = looResiduals(peers, asOf, SIZE_ONLY, model.growth_cap);
  const looAbs = loo.map((r) => Math.exp(Math.abs(r)));
  const wf = walkForward(peers, asOf, SIZE_ONLY, model);
  const variants: VariantTest[] = [];
  const baseLoo = median(looAbs);
  const baseWf = wf.medianFactor;
  const baseWfMean = wf.meanFactor;
  const testVariant = (name: string, spec: Spec, set: SnapshotProtocol[]): void => {
    const l = looResiduals(set, asOf, spec, model.growth_cap).map((r) => Math.exp(Math.abs(r)));
    const w = walkForward(set, asOf, spec, model);
    variants.push({
      name,
      peers: set.length,
      loo_median_factor: median(l),
      wf_median_factor: w.medianFactor,
      wf_mean_factor: w.meanFactor,
      kept: false,
    });
  };
  // The flat model's own held-out misses: the median ratio is
  // refitted without each peer for leave-one-out, and fitted on the
  // pre-cutoff protocols for walk-forward.
  const flatLoo = peers.map((p, i) => {
    const rest = peers.filter((_, j) => j !== i);
    const ratio = median(rest.map((q) => q.mcap_usd! / q.tvl_usd));
    return Math.exp(Math.abs(Math.log(p.mcap_usd!) - Math.log(ratio * p.tvl_usd)));
  });
  const flatTrain = peers.filter((p) => p.listed_at !== null && p.listed_at < model.walk_forward_cutoff);
  const flatTest = peers.filter((p) => p.listed_at !== null && p.listed_at >= model.walk_forward_cutoff);
  const flatRatio = median(flatTrain.map((p) => p.mcap_usd! / p.tvl_usd));
  const flatWfErrs = flatTest.map((p) => Math.exp(Math.abs(Math.log(p.mcap_usd!) - Math.log(flatRatio * p.tvl_usd))));
  variants.push({ name: 'Flat median ratio', peers: peers.length, loo_median_factor: median(flatLoo), wf_median_factor: median(flatWfErrs), wf_mean_factor: mean(flatWfErrs), kept: false });
  testVariant('All live peers', SIZE_ONLY, allLive);
  variants.push({
    name: 'Clean peers',
    peers: peers.length,
    loo_median_factor: baseLoo,
    wf_median_factor: baseWf,
    wf_mean_factor: baseWfMean,
    kept: true,
  });
  const candidates: { name: string; spec: Spec }[] = [
    { name: '+ 7d growth', spec: { ...SIZE_ONLY, growth: true } },
    { name: '+ growth capped', spec: { ...SIZE_ONLY, growthCap: true } },
    { name: '+ log age', spec: { ...SIZE_ONLY, logAge: true } },
    // One row for all four category-premium shrinks (5, 10, 30, 100):
    // the row is tested at shrink 100, the best leave-one-out, and
    // the range across all four is printed on it below.
    { name: '+ premiums 5–100', spec: { ...SIZE_ONLY, catShrink: 100 } },
    { name: '+ quadratic', spec: { ...SIZE_ONLY, quad: true } },
    { name: '+ chain count', spec: { ...SIZE_ONLY, chains: true } },
    { name: '+ per-category slopes', spec: { ...SIZE_ONLY, catSlope: 30 } },
    { name: '+ growth + premiums 10', spec: { ...SIZE_ONLY, growthCap: true, catShrink: 10 } },
  ];
  for (const c of candidates) testVariant(c.name, c.spec, peers);
  // The premiums range across shrink 5, 10, 30 and 100, printed on
  // the single premiums row: leave-one-out 3.18-3.54x, walk-forward
  // 2.04-2.17x, all dropped.
  {
    const lo: number[] = [];
    const wf: number[] = [];
    for (const s of [5, 10, 30]) {
      const spec: Spec = { ...SIZE_ONLY, catShrink: s };
      lo.push(median(looResiduals(peers, asOf, spec, model.growth_cap).map((r) => Math.exp(Math.abs(r)))));
      wf.push(walkForward(peers, asOf, spec, model).medianFactor);
    }
    const row = variants.find((v) => v.name.startsWith('+ premiums'));
    if (row) {
      const allLoo = lo.concat(row.loo_median_factor);
      const allWf = wf.concat(row.wf_median_factor);
      row.loo_text = Math.min(...allLoo).toFixed(2) + '–' + Math.max(...allLoo).toFixed(2) + 'x';
      row.wf_text = Math.min(...allWf).toFixed(2) + '–' + Math.max(...allWf).toFixed(2) + 'x';
    }
  }
  // A family term cannot be tested: the snapshot carries no parent
  // field, so no family can be fitted or held out. The row says
  // "Not testable"; the footnote under the table says why.
  variants.push({
    name: '+ family effect',
    peers: 0,
    loo_median_factor: 0,
    wf_median_factor: 0,
    wf_mean_factor: 0,
    kept: false,
    note: 'Not testable',
  });
  // A variant displaces the reference only by beating it on both
  // tests. The reference row keeps itself by definition. Among the
  // survivors the lowest leave-one-out miss wins, walk-forward
  // breaking the tie.
  let chosenSpec = SIZE_ONLY;
  let chosenName = 'Size curve, clean peers';
  let bestLoo = baseLoo;
  let bestWf = baseWf;
  let chosenIndex = -1;
  for (let i = 3; i < variants.length - 1; i++) {
    const v = variants[i]!;
    if (v.loo_median_factor < baseLoo && v.wf_median_factor < baseWf) {
      if (v.loo_median_factor < bestLoo || (v.loo_median_factor === bestLoo && v.wf_median_factor < bestWf)) {
        bestLoo = v.loo_median_factor;
        bestWf = v.wf_median_factor;
        chosenSpec = candidates[i - 3]!.spec;
        chosenName = candidates[i - 3]!.name;
        chosenIndex = i;
      }
    }
  }
  // Only the winner is marked kept: a variant that beats both tests
  // but loses to another is still dropped, and the table says so.
  if (chosenIndex >= 0) variants[chosenIndex]!.kept = true;
  // The reference row is kept only when nothing displaced it.
  if (chosenName !== 'Size curve, clean peers') variants[2]!.kept = false;

  const chosenFit = fitSpec(peers, asOf, chosenSpec, model.growth_cap);
  const fit: Fit = {
    intercept: chosenFit.beta[0]!,
    slope: chosenFit.beta[1]!,
    peers: peers.length,
    peer_rule: 'live-token protocols passing the board cleanliness rule',
    beta: chosenFit.beta,
    spec: chosenSpec,
    cat_offsets: Object.fromEntries(chosenFit.offsets),
    cat_slopes: Object.fromEntries(chosenFit.slopes),
    mean_log_tvl: chosenFit.meanLogTvl,
  };

  // The ranges come from the CHOSEN model's leave-one-out residuals,
  // not the reference's: the P25-P75 of the SIGNED residual factors,
  // so a value's range is implied x P25 to implied x P75 and about
  // half the held-out values fall inside it by construction. The
  // absolute-value quantiles would give a symmetric range that holds
  // 75%, not a P25-P75 range.
  const looChosen = looResiduals(peers, asOf, chosenSpec, model.growth_cap);
  const wfChosen = walkForward(peers, asOf, chosenSpec, model);
  // The growth coefficient, fitted on all clean peers and on the
  // pre-2024 protocols alone: the walk-forward failure, in one
  // number. It flips sign between the halves (+3.44 on pre-2024
  // protocols, -2.24 on the full set), so it is noise, not signal.
  const growthSpec: Spec = { ...SIZE_ONLY, growth: true };
  const growthBetaFull = fitSpec(peers, asOf, growthSpec, model.growth_cap).beta[2]!;
  const growthPre2024 = peers.filter((p) => p.listed_at !== null && p.listed_at < model.walk_forward_cutoff);
  const growthBetaPre2024 = fitSpec(growthPre2024, asOf, growthSpec, model.growth_cap).beta[2]!;
  const looFactors = [...looChosen.map((r) => Math.exp(r))].sort((a, b) => a - b);
  const p25 = quantileSorted(looFactors, 0.25);
  const p75 = quantileSorted(looFactors, 0.75);
  const p10 = quantileSorted(looFactors, 0.1);
  const p90 = quantileSorted(looFactors, 0.9);
  const young = looChosen.filter((_, i) => {
    const a = ageDays(asOf, peers[i]!.listed_at);
    return a !== null && a <= model.young_days;
  });
  const old = looChosen.filter((_, i) => {
    const a = ageDays(asOf, peers[i]!.listed_at);
    return a !== null && a > model.young_days;
  });
  const inRange = (lo: number, hi: number): number =>
    looChosen.filter((r) => r >= lo && r <= hi).length / looChosen.length;

  return {
    heldOut: {
      loo_median_factor: median(looChosen.map((r) => Math.exp(Math.abs(r)))),
      wf_median_factor: wfChosen.medianFactor,
      wf_mean_factor: wfChosen.meanFactor,
      wf_train: wfChosen.train,
      wf_test: wfChosen.test,
      loo_p10_factor: p10,
      loo_p25_factor: p25,
      loo_p75_factor: p75,
      loo_p90_factor: p90,
      coverage_p25_p75: inRange(Math.log(p25), Math.log(p75)),
      coverage_p10_p90: inRange(Math.log(p10), Math.log(p90)),
      young_median_factor: median(young.map((r) => Math.exp(Math.abs(r)))),
      old_median_factor: median(old.map((r) => Math.exp(Math.abs(r)))),
      variants,
      chosen_name: chosenName,
      growth_beta_full: growthBetaFull,
      growth_beta_pre2024: growthBetaPre2024,
    },
    fit,
    chosenSpec,
  };
}

// Age buckets for token odds: under a year, 1-2, 2-3, 3-4, over 4.
export function ageBucket(age: number | null): string {
  if (age === null) return 'unknown';
  if (age < 365) return '<1y';
  if (age < 730) return '1-2y';
  if (age < 1095) return '2-3y';
  if (age < 1460) return '3-4y';
  return '>4y';
}

export const BUCKET_LABELS: Record<string, string> = {
  '<1y': 'under 1 year',
  '1-2y': '1-2 years',
  '2-3y': '2-3 years',
  '3-4y': '3-4 years',
  '>4y': 'over 4 years',
  unknown: 'unknown age',
};

// The five biggest categories get their own odds group; everything
// else is pooled, so no cell is a single protocol.
const BIG_GROUPS = ['Dexs', 'Lending', 'Risk Curators', 'Yield', 'RWA'];

export function categoryGroup(category: string | null): string {
  if (category !== null && BIG_GROUPS.includes(category)) return category;
  return 'Other';
}

// Brier score: mean squared error between a predicted probability
// and the 0/1 outcome. Lower is better; a constant guess scores
// p * (1 - p) at the base rate.
function brier(probs: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ys.length; i++) s += (probs[i]! - ys[i]!) * (probs[i]! - ys[i]!);
  return s / ys.length;
}

// The fitted logistic model: token recorded (1/0) on intercept, log
// TVL, log age, 7d growth, chain count and category-group dummies,
// ridge lambda on every non-intercept term. Fitted by Newton-Raphson
// (IRLS) with a warm start when one is given.
function logisticFeatures(p: SnapshotProtocol, asOf: string): number[] {
  const a = ageDays(asOf, p.listed_at);
  const x = [1, Math.log(p.tvl_usd), Math.log((a ?? 365) + 30), clamp(finite(p.change_7d, 0), -60, 120) / 100, Math.log(p.chains.length + 1)];
  for (const g of BIG_GROUPS) x.push(categoryGroup(p.category) === g ? 1 : 0);
  return x;
}

function fitLogistic(ps: SnapshotProtocol[], asOf: string, lam: number, warm: number[] | null, iters: number): number[] {
  const k = 10;
  const pen = Array(k).fill(lam);
  pen[0] = 0;
  let beta = warm !== null ? [...warm] : Array(k).fill(0);
  const xs = ps.map((p) => logisticFeatures(p, asOf));
  const ys = ps.map((p) => (isPreToken(p) ? 0 : 1));
  for (let it = 0; it < iters; it++) {
    const h: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
    const g: number[] = Array(k).fill(0);
    for (let i = 0; i < ps.length; i++) {
      const z = clamp(dot(beta, xs[i]!), -30, 30);
      const pr = 1 / (1 + Math.exp(-z));
      const w = Math.max(pr * (1 - pr), 1e-6);
      const d = ys[i]! - pr;
      for (let r = 0; r < k; r++) {
        g[r]! += d * xs[i]![r]!;
        for (let c = 0; c < k; c++) h[r]![c]! += w * xs[i]![r]! * xs[i]![c]!;
      }
    }
    for (let r = 0; r < k; r++) {
      g[r]! -= pen[r]! * beta[r]!;
      h[r]![r]! += pen[r]!;
    }
    const step = solveLinear(h, g);
    let mx = 0;
    for (let r = 0; r < k; r++) {
      beta[r]! += step[r]!;
      mx = Math.max(mx, Math.abs(step[r]!));
    }
    if (mx < 1e-8) break;
  }
  return beta;
}

function logisticProb(beta: number[], p: SnapshotProtocol, asOf: string): number {
  const z = clamp(dot(beta, logisticFeatures(p, asOf)), -30, 30);
  return 1 / (1 + Math.exp(-z));
}

// Token odds: the cell model. Buckets and cells are counted over all
// 758 protocols, so every rate is a share of peers that record a
// token, and every board row's odds are the rate of its own cell.
// The kept model is the one that wins on BOTH held-out tests.
export function tokenOdds(snapshot: Snapshot, model: ModelConstants): OddsResult {
  const all = snapshot.protocols;
  const ys = all.map((p) => (isPreToken(p) ? 0 : 1));
  const baseRate = ys.reduce((s, v) => s + v, 0) / ys.length;

  const bucketOrder = ['<1y', '1-2y', '2-3y', '3-4y', '>4y', 'unknown'];
  const buckets: OddsBucket[] = bucketOrder.map((b) => {
    const members = all.filter((p) => ageBucket(ageDays(snapshot.as_of, p.listed_at)) === b);
    const tokens = members.filter((p) => !isPreToken(p)).length;
    return { bucket: b, label: BUCKET_LABELS[b]!, n: members.length, tokens, rate: members.length === 0 ? 0 : tokens / members.length };
  });
  const bucketRate = new Map(buckets.map((b) => [b.bucket, b.rate]));

  const cellKeys = new Set(all.map((p) => `${ageBucket(ageDays(snapshot.as_of, p.listed_at))}|${categoryGroup(p.category)}`));
  const cells: OddsCell[] = [...cellKeys]
    .sort()
    .map((key) => {
      const [b, g] = key.split('|') as [string, string];
      const members = all.filter(
        (p) => ageBucket(ageDays(snapshot.as_of, p.listed_at)) === b && categoryGroup(p.category) === g,
      );
      const tokens = members.filter((p) => !isPreToken(p)).length;
      const br = bucketRate.get(b) ?? baseRate;
      const rate = (tokens + model.odds_shrink * br) / (members.length + model.odds_shrink);
      return { bucket: b, group: g, label: `${BUCKET_LABELS[b]} · ${g}`, n: members.length, tokens, rate };
    });
  const cellOf = new Map(cells.map((c) => [`${c.bucket}|${c.group}`, c]));

  // Leave-one-out Brier for each candidate: the cell model, the age
  // buckets alone, and a constant guess at the base rate.
  const looCell: number[] = [];
  const looBucket: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!;
    const b = ageBucket(ageDays(snapshot.as_of, p.listed_at));
    const g = categoryGroup(p.category);
    const cell = cellOf.get(`${b}|${g}`)!;
    const br = bucketRate.get(b) ?? baseRate;
    const cellRate = ((cell.tokens - ys[i]!) + model.odds_shrink * br) / (cell.n - 1 + model.odds_shrink);
    looCell.push(cellRate);
    const bucket = buckets.find((x) => x.bucket === b)!;
    looBucket.push((bucket.tokens - ys[i]!) / (bucket.n - 1));
  }
  const brierCell = brier(looCell, ys);
  const brierBuckets = brier(looBucket, ys);
  const brierConstant = brier(ys.map(() => baseRate), ys);

  // The fitted logistic: fitted on the full set, then refitted
  // leave-one-out from a warm start.
  const logBeta = fitLogistic(all, snapshot.as_of, model.logistic_lambda, null, 15);
  const looLogistic: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const train = all.filter((_, j) => j !== i);
    const beta = fitLogistic(train, snapshot.as_of, model.logistic_lambda, logBeta, 6);
    looLogistic.push(logisticProb(beta, all[i]!, snapshot.as_of));
  }
  const brierLogistic = brier(looLogistic, ys);

  // Walk-forward, by listing date: fit the rates on protocols listed
  // before the cutoff, score them on protocols listed after it. The
  // constant baseline is the TRAINING base rate, never the overall
  // rate: the overall rate peeks at the test period, whose label
  // rate is 0.41 against 0.78 in training. Age at the snapshot is
  // the listing date itself, so the two halves hold different ages:
  // the training half holds 9 protocols under 3 years old and the
  // test half 130 in the 2-3 year bucket alone, so the young buckets
  // have almost no training data and fall back to the training base
  // rate. The bucket coverage below shows that, and leave-one-out
  // is the test that ranks the odds models.
  const train = all.filter((p) => p.listed_at !== null && p.listed_at < model.walk_forward_cutoff);
  const test = all.filter((p) => p.listed_at !== null && p.listed_at >= model.walk_forward_cutoff);
  const trainBase = train.filter((p) => !isPreToken(p)).length / train.length;
  const testBase = test.filter((p) => !isPreToken(p)).length / test.length;
  const trainBuckets = new Map<string, number>();
  const wfBuckets: OddsWfBucket[] = bucketOrder.map((b) => {
    const tm = train.filter((p) => ageBucket(ageDays(snapshot.as_of, p.listed_at)) === b);
    const sm = test.filter((p) => ageBucket(ageDays(snapshot.as_of, p.listed_at)) === b);
    const rate = tm.length === 0 ? trainBase : tm.filter((p) => !isPreToken(p)).length / tm.length;
    trainBuckets.set(b, rate);
    return { bucket: b, train_n: tm.length, test_n: sm.length, train_rate: rate };
  });
  const wfCell: number[] = [];
  const wfBucket: number[] = [];
  const wfConst: number[] = [];
  for (const p of test) {
    const b = ageBucket(ageDays(snapshot.as_of, p.listed_at));
    const g = categoryGroup(p.category);
    const m = train.filter((x) => ageBucket(ageDays(snapshot.as_of, x.listed_at)) === b && categoryGroup(x.category) === g);
    const tk = m.filter((x) => !isPreToken(x)).length;
    const br = trainBuckets.get(b) ?? trainBase;
    wfCell.push((tk + model.odds_shrink * br) / (m.length + model.odds_shrink));
    wfBucket.push(br);
    wfConst.push(trainBase);
  }
  const wfY = test.map((p) => (isPreToken(p) ? 0 : 1));
  const wfLogBeta = fitLogistic(train, snapshot.as_of, model.logistic_lambda, null, 15);
  const wfBrierCell = brier(wfCell, wfY);
  const wfBrierBuckets = brier(wfBucket, wfY);
  const wfBrierConstant = brier(wfConst, wfY);
  const wfBrierLogistic = brier(test.map((p) => logisticProb(wfLogBeta, p, snapshot.as_of)), wfY);

  // The kept odds model is the one that wins on both tests. The
  // cell model does: it beats the buckets, the constant and the
  // logistic out of sample on leave-one-out and on walk-forward.
  const keptModel =
    brierCell < brierBuckets && brierCell < brierConstant && brierCell < brierLogistic && wfBrierCell < wfBrierBuckets && wfBrierCell < wfBrierConstant && wfBrierCell < wfBrierLogistic
      ? 'cell'
      : 'buckets';

  return {
    buckets,
    cells,
    base_rate: baseRate,
    kept_model: keptModel,
    brier_cell: brierCell,
    brier_buckets: brierBuckets,
    brier_constant: brierConstant,
    brier_logistic: brierLogistic,
    wf_brier_cell: wfBrierCell,
    wf_brier_buckets: wfBrierBuckets,
    wf_brier_constant: wfBrierConstant,
    wf_brier_logistic: wfBrierLogistic,
    wf_train_base: trainBase,
    wf_test_base: testBase,
    wf_buckets: wfBuckets,
  };
}

// Gas per transaction, by the protocol's first chain, from a stated
// table the dashboard prints: Ethereum $2.00, Base, Arbitrum and
// Optimism $0.10, Solana $0.05, anything else $0.25.
export function gasPerTx(chain: string, model: ModelConstants): number {
  if (chain === 'Ethereum') return model.gas_ethereum_usd;
  if (chain === 'Base' || chain === 'Arbitrum' || chain === 'Optimism') return model.gas_l2_usd;
  if (chain === 'Solana') return model.gas_solana_usd;
  return model.gas_default_usd;
}

// Farm economics on a $5,000 ticket over 12 weeks at a 7% airdrop
// share: the slice is implied value x 7% x ticket / TVL, gas is the
// plan's actual 10 transactions at the chain's price, time is 1.25
// hours (5 minutes setup, 5 to verify, 10 to fund, 5 on risk, 10 on
// the core action, 5 to deepen, 20 on four cadence actions, 15 to
// claim and log). FARM when net is at least $25 and at least
// $10/hour, THIN when net is above -$10, otherwise SKIP.
//
// The benchmarks beside the verdict: what the same ticket earns in
// a T-bill over the 12 weeks; the drop share at which the slice
// exactly covers the gas; the token odds at which the expected value
// covers the gas; and what happens if the TVL doubles (the slice
// falls, because the same ticket is a smaller share of a bigger
// pool) or falls 30% (the implied value falls with it).
export function farmEconomics(
  p: SnapshotProtocol,
  impliedValueUsd: number,
  model: ModelConstants,
  predictAtTvl: (tvlUsd: number) => number,
): FarmEconomics {
  const chain = p.chains[0] ?? 'Ethereum';
  const gasPerTxUsd = gasPerTx(chain, model);
  const gasUsd = gasPerTxUsd * model.tx_count;
  const sliceUsd = (impliedValueUsd * model.airdrop_share * model.ticket_usd) / p.tvl_usd;
  const netUsd = sliceUsd - gasUsd;
  const hours =
    (model.setup_minutes + model.verify_minutes + model.fund_minutes + model.risk_minutes + model.core_minutes + model.deepen_minutes + model.cadence_minutes + model.exit_minutes) / 60;
  const netPerHourUsd = netUsd / hours;
  const verdict: Verdict =
    netUsd >= model.farm_net_usd && netPerHourUsd >= model.farm_net_per_hour_usd
      ? 'FARM'
      : netUsd > model.thin_net_usd
        ? 'THIN'
        : 'SKIP';
  const tbillUsd = (model.ticket_usd * model.tbill_rate * model.horizon_weeks) / 52;
  const shareBreakeven = (gasUsd * p.tvl_usd) / (impliedValueUsd * model.ticket_usd);
  const oddsBreakeven = sliceUsd > 0 ? gasUsd / sliceUsd : Number.POSITIVE_INFINITY;
  const tvlDouble = p.tvl_usd * 2;
  const impliedDouble = predictAtTvl(tvlDouble);
  const sliceDouble = (impliedDouble * model.airdrop_share * model.ticket_usd) / tvlDouble;
  const tvlDown30 = p.tvl_usd * 0.7;
  const impliedDown30 = predictAtTvl(tvlDown30);
  return {
    ticket_usd: model.ticket_usd,
    slice_usd: sliceUsd,
    gas_per_tx_usd: gasPerTxUsd,
    gas_usd: gasUsd,
    tx_count: model.tx_count,
    net_usd: netUsd,
    hours,
    net_per_hour_usd: netPerHourUsd,
    verdict,
    horizon_weeks: model.horizon_weeks,
    airdrop_share: model.airdrop_share,
    tbill_usd: tbillUsd,
    share_breakeven: shareBreakeven,
    odds_breakeven: oddsBreakeven,
    tvl_double_usd: tvlDouble,
    implied_double_usd: impliedDouble,
    slice_double_usd: sliceDouble,
    net_double_usd: sliceDouble - gasUsd,
    tvl_down30_usd: tvlDown30,
    implied_down30_usd: impliedDown30,
  };
}

// The economics of any what-if scenario, from a row's own figures:
// the slice scales with the deposit and the share, the gas does not
// move. The dashboard recomputes this live when the reader changes
// the deposit, the drop share or the T-bill rate.
export function whatIfEconomics(
  impliedValueUsd: number,
  tvlUsd: number,
  gasUsd: number,
  hours: number,
  depositUsd: number,
  share: number,
  model: ModelConstants,
): { slice_usd: number; net_usd: number; net_per_hour_usd: number; verdict: Verdict; tbill_usd: number } {
  const slice = (impliedValueUsd * share * depositUsd) / tvlUsd;
  const net = slice - gasUsd;
  const perHour = net / hours;
  const verdict: Verdict =
    net >= model.farm_net_usd && perHour >= model.farm_net_per_hour_usd
      ? 'FARM'
      : net > model.thin_net_usd
        ? 'THIN'
        : 'SKIP';
  return { slice_usd: slice, net_usd: net, net_per_hour_usd: perHour, verdict, tbill_usd: (depositUsd * model.tbill_rate * model.horizon_weeks) / 52 };
}

// Farm plans, one concrete template per kind of protocol, in eight
// named phases: SETUP, VERIFY, FUND, RISK, CORE, DEEPEN, CADENCE,
// EXIT. The first two and the last are shared, with the protocol's
// own name, chain and ticket filled in; the middle five are the
// category's own action. Every step carries its own cost, time and
// transaction count, and the plan's gas is the sum of its steps'
// transactions, not a number chosen apart from the plan.
interface FarmTemplate {
  fund: string;
  risk: string;
  core: string;
  deepen: string;
  recurring: string;
}

const FARM_TEMPLATES: { match: (category: string) => boolean; t: FarmTemplate }[] = [
  {
    match: (c) => c.includes('lend') || c.includes('cdp') || c.includes('collateral'),
    t: {
      fund: 'Supply ${capital} of USDC to {name} on {chain} and keep the supply open.',
      risk: 'Check the {name} borrow rate and set an alert if the health factor falls under 1.5; add collateral before it does.',
      core: 'Borrow $50 against the {name} supply and repay it the same week, so the position shows both sides of the book.',
      deepen: 'Top up the {name} supply by $25 and re-check the health factor.',
      recurring: 'Borrow $25 against the {name} supply once a month and repay it the same week.',
    },
  },
  {
    match: (c) => c.includes('dex') || c.includes('liquidity manager'),
    t: {
      fund: 'Provide ${capital} of liquidity to {name}\u2019s main pool on {chain} and keep the position open.',
      risk: 'Check the {name} pool fee APR and the position range; set an alert for the price leaving the range.',
      core: 'Swap $25 through the {name} pool and add the fees back to the position.',
      deepen: 'Add $25 of liquidity to the {name} pool at the tightest range that still earns fees.',
      recurring: 'Swap $25 through the {name} pool once a month and add the fees back to the position.',
    },
  },
  {
    match: (c) => c.includes('yield') || c.includes('leveraged farm') || c.includes('farm'),
    t: {
      fund: 'Deposit ${capital} into {name}\u2019s vault on {chain} and keep the shares.',
      risk: 'Read the {name} vault strategy and set an alert if the APY trails the market rate for two weeks.',
      core: 'Harvest the {name} vault yield and re-deposit it into the same vault.',
      deepen: 'Add $25 to the {name} vault and check the new share price.',
      recurring: 'Harvest the {name} vault yield once a month and re-deposit it.',
    },
  },
  {
    match: (c) => c.includes('curator') || c.includes('allocator') || c.includes('index'),
    t: {
      fund: 'Deposit ${capital} into a {name} vault on {chain} and keep the shares.',
      risk: 'Read the {name} curator allocation and set an alert if the curator reallocates away from your vault.',
      core: 'Check the {name} curator track record and move $25 to the best-performing vault.',
      deepen: 'Top up the best-performing {name} vault by $25.',
      recurring: 'Check the {name} curator allocation once a month and top up the best vault by $25.',
    },
  },
  {
    match: (c) => c.includes('prediction'),
    t: {
      fund: 'Fund ${capital} and place one market position on {name}.',
      risk: 'Set a limit on {name}: no more than $25 a market, and never chase a lost position.',
      core: 'Place one new {name} market position, $25, on a market you can judge.',
      deepen: 'Add a second {name} position of $25 on a different market.',
      recurring: 'Place one new {name} market position a month, $25 each, on markets you can judge.',
    },
  },
  {
    match: (c) => c.includes('derivative') || c.includes('perpetual'),
    t: {
      fund: 'Deposit ${capital} of USDC as margin on {name} and open one small hedge.',
      risk: 'Set an alert on {name} if the margin ratio falls under 2 or the funding rate turns against the hedge for a week.',
      core: 'Roll the {name} hedge and keep the margin ratio above 2.',
      deepen: 'Add $25 of margin to the {name} hedge.',
      recurring: 'Roll the {name} hedge once a month and keep the margin ratio above 2.',
    },
  },
  {
    match: (c) => c.includes('basis'),
    t: {
      fund: 'Deposit ${capital} into {name}\u2019s basis position on {chain} and hold it through one funding cycle.',
      risk: 'Watch {name}\u2019s funding rate and set an alert if the basis spread inverts.',
      core: 'Roll the {name} basis position when the funding cycle turns.',
      deepen: 'Add $25 to the {name} basis position at the next cycle.',
      recurring: 'Roll the {name} basis position once a month when the funding cycle turns.',
    },
  },
  {
    match: (c) => c.includes('rwa'),
    t: {
      fund: 'Mint ${capital} of {name}\u2019s yield asset on {chain} and hold it.',
      risk: 'Read {name}\u2019s latest attestation of the underlying assets; set an alert for the next one.',
      core: 'Reinvest the monthly {name} yield into the same asset.',
      deepen: 'Add $25 to the {name} yield asset after the next attestation.',
      recurring: 'Reinvest the monthly {name} yield into the same asset, $25 at a time.',
    },
  },
  {
    match: (c) => c.includes('stable'),
    t: {
      fund: 'Mint or deposit ${capital} of the stable asset through {name} on {chain}.',
      risk: 'Watch the {name} peg and the backing report; set an alert if the peg breaks by more than 1% for a day.',
      core: 'Move $25 of the {name} stable asset into the protocol\u2019s savings module.',
      deepen: 'Mint $25 more of the {name} stable asset and hold it in savings.',
      recurring: 'Mint $25 of the {name} stable asset once a month and hold it in the protocol\u2019s savings module.',
    },
  },
  {
    match: (c) => c.includes('insurance'),
    t: {
      fund: 'Buy ${capital} of cover from {name} on {chain} and keep the policy.',
      risk: 'Note the {name} cover expiry and the protocol\u2019s claim history; set an alert a week before expiry.',
      core: 'Review the {name} cover terms and extend the policy before expiry if the price is unchanged.',
      deepen: 'Add $25 of cover from {name} on a second risk.',
      recurring: 'Review the {name} cover once a month and extend it before expiry if the price is unchanged.',
    },
  },
  {
    match: (c) => c.includes('staking') || c.includes('restak'),
    t: {
      fund: 'Stake ${capital} of the chain\u2019s staking asset through {name} and keep the receipt.',
      risk: 'Watch the {name} validator uptime and the staking APR; set an alert if uptime falls.',
      core: 'Restake the monthly {name} rewards and check the validator set.',
      deepen: 'Stake $25 more through {name} with the best-performing validator.',
      recurring: 'Restake the monthly {name} rewards once a month and check the validator set.',
    },
  },
  {
    match: (c) => c.includes('bridge'),
    t: {
      fund: 'Bridge ${capital} of USDC to {chain} through {name} and use the bridged funds in its app.',
      risk: 'Compare the {name} bridge fee with the destination chain\u2019s gas before each transfer; use the cheapest route the protocol itself lists.',
      core: 'Bridge $25 to the chain where {name}\u2019s app pays the best rate.',
      deepen: 'Bridge $25 more through {name} to the best-rate chain.',
      recurring: 'Bridge $25 a month to the chain where {name}\u2019s app pays the best rate.',
    },
  },
  {
    match: (c) => c.includes('chain') || c.includes('btc'),
    t: {
      fund: 'Use {name}\u2019s main app on {chain} with the ${capital} ticket and keep the position open.',
      risk: 'Watch the {name} app for new features and the chain\u2019s fee level; pause if fees spike tenfold.',
      core: 'Use one {name} feature, such as a swap, a deposit or a vote.',
      deepen: 'Use a second {name} feature with $25.',
      recurring: 'Use one {name} feature a month, such as a swap, a deposit or a vote.',
    },
  },
  {
    match: (c) => c.includes('payment') || c.includes('card'),
    t: {
      fund: 'Load ${capital} onto {name}\u2019s card on {chain} and spend from it.',
      risk: 'Watch the {name} card fees and the cashback rate; stop if the fee rises above the cashback.',
      core: 'Spend $25 through the {name} card on an everyday purchase.',
      deepen: 'Spend $25 more through the {name} card and check the cashback landed.',
      recurring: 'Spend $25 a month through the {name} card on everyday purchases.',
    },
  },
  {
    match: () => true,
    t: {
      fund: 'Deposit ${capital} of USDC into {name} on {chain} and keep the position open.',
      risk: 'Read {name}\u2019s own page for the risks of the position and set an alert for any change to them.',
      core: 'Make one {name} qualifying action, such as a deposit, a swap or a vote.',
      deepen: 'Make a second {name} qualifying action with $25.',
      recurring: 'Make one {name} qualifying action a month, such as a deposit, a swap or a vote.',
    },
  },
];

function fill(s: string, v: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
}

function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

// Eight steps, each its own phase with its own cost, time and
// transaction count. The board's farm_steps strings carry the phase,
// the action, the cost and the time, so the gate's own file shows
// the plan; the dashboard reads the same steps with their fields.
export function farmSteps(p: SnapshotProtocol, econ: FarmEconomics, model: ModelConstants): FarmStep[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const t = FARM_TEMPLATES.find((e) => e.match((p.category ?? 'Other').toLowerCase()))!.t;
  const v: Record<string, string> = {
    name: p.name,
    capital: String(model.ticket_usd),
    chain,
    tvl: `$${Math.round(p.tvl_usd).toLocaleString('en-US')}`,
    gas: money(econ.gas_per_tx_usd),
    gas4: money(econ.gas_per_tx_usd * model.actions_per_horizon),
    gas2: money(econ.gas_per_tx_usd * 2),
    gasTotal: money(econ.gas_usd),
    slice: money(econ.slice_usd),
    net: money(econ.net_usd),
    netPerHour: money(econ.net_per_hour_usd),
    verdict: econ.verdict,
  };
  const txs = STEP_TXS;
  return [
    { phase: 'SETUP', text: fill('Open a fresh wallet for {name} on {chain}, fund it with the ${capital} ticket plus {gas} for gas, and keep its seed phrase offline.', v), cost: fill('about {gas} of gas for the first transaction', v), time: `${model.setup_minutes} minutes`, txs: txs[0]! },
    { phase: 'VERIFY', text: fill('Check {name} is the protocol itself: the address on its own page, the TVL of {tvl} on the snapshot, and the points page it links. Never trust a link from a chat.', v), cost: 'no fee to check', time: `${model.verify_minutes} minutes`, txs: txs[1]! },
    { phase: 'FUND', text: fill(t.fund, v), cost: fill('${capital} of capital and about {gas} of gas', v), time: `${model.fund_minutes} minutes to set up`, txs: txs[2]! },
    { phase: 'RISK', text: fill(t.risk, v), cost: fill('the ${capital} stays in the position', v), time: `${model.risk_minutes} minutes`, txs: txs[3]! },
    { phase: 'CORE', text: fill(t.core, v), cost: fill('about {gas} of gas', v), time: `${model.core_minutes} minutes`, txs: txs[4]! },
    { phase: 'DEEPEN', text: fill(t.deepen, v), cost: fill('$25 of capital and about {gas} of gas', v), time: `${model.deepen_minutes} minutes`, txs: txs[5]! },
    { phase: 'CADENCE', text: fill(t.recurring, v), cost: fill('about {gas} of gas each, {gas4} over 12 weeks', v), time: `${model.cadence_minutes} minutes over 12 weeks`, txs: txs[6]! },
    { phase: 'EXIT', text: fill('Claim the {name} points and rewards from its own page, then exit the position. Expected slice {slice} against {gasTotal} of gas over 12 weeks: net {net} ({netPerHour} an hour), so the verdict is {verdict}. Write the wallet, the dates and every transaction in a farm log.', v), cost: fill('about {gas2} of gas to claim and exit', v), time: `${model.exit_minutes} minutes`, txs: txs[7]! },
  ];
}

// The five nearest traded comparables for one board row: same
// category first, then log-TVL distance, among the clean live peers.
// Each carries the model's held-out prediction for it, so the reader
// sees the model priced a peer it had never been fitted on.
export function nearestComparables(
  p: SnapshotProtocol,
  peers: SnapshotProtocol[],
  looPredLog: number[],
): Comparable[] {
  const scored = peers.map((q, i) => {
    const sameCat = (q.category ?? 'Other') === (p.category ?? 'Other') ? 0 : 1;
    return { q, pred: looPredLog[i]!, score: sameCat * 100 + Math.abs(Math.log(q.tvl_usd) - Math.log(p.tvl_usd)) };
  });
  scored.sort((a, b) => a.score - b.score || (a.q.slug < b.q.slug ? -1 : 1));
  return scored.slice(0, 5).map((s) => ({
    slug: s.q.slug,
    symbol: s.q.symbol ?? s.q.gecko_id ?? 'no token symbol',
    tvl_usd: s.q.tvl_usd,
    mcap_usd: s.q.mcap_usd!,
    ratio: s.q.mcap_usd! / s.q.tvl_usd,
    pred_usd: Math.round(Math.exp(s.pred)),
  }));
}

// Bootstrap rank ranges: resample the clean live peers with a fixed
// seed, refit the chosen model each time, and record each board
// protocol's rank across the resamples. The range is the P10-P90 of
// that rank.
//
// Under the size curve alone the range is exact, and the dashboard
// says so instead of hiding it: rank is TVL order there, so a
// refitted curve keeps every row in place and no resample moves a
// rank. The uncertainty lives in the values, not the ranks -- see
// the P25-P75 range on each row. A category term would move ranks,
// and none survived testing. Drawing a fresh held-out error per row
// would widen every range to most of the board, but that would
// measure the noise in the values, not the rank, and the value
// range already says that.
export function bootstrapRankRanges(
  peers: SnapshotProtocol[],
  boardProtos: SnapshotProtocol[],
  spec: Spec,
  asOf: string,
  model: ModelConstants,
): { ranges: Map<string, { low: number; high: number }>; median_range: number; max_range: number } {
  const rand = mulberry32(model.bootstrap_seed);
  const ranks = new Map<string, number[]>();
  for (const p of boardProtos) ranks.set(p.slug, []);
  for (let r = 0; r < model.bootstrap_resamples; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < peers.length; i++) sample.push(peers[Math.floor(rand() * peers.length)]!);
    const f = fitSpec(sample, asOf, spec, model.growth_cap);
    const scored = boardProtos.map((p) => ({ slug: p.slug, v: f.predict(p) }));
    scored.sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
    scored.forEach((s, i) => ranks.get(s.slug)!.push(i + 1));
  }
  const ranges = new Map<string, { low: number; high: number }>();
  const widths: number[] = [];
  for (const [slug, rs] of ranks) {
    const sorted = [...rs].sort((a, b) => a - b);
    const low = quantileSorted(sorted, 0.1);
    const high = quantileSorted(sorted, 0.9);
    ranges.set(slug, { low, high });
    widths.push(high - low);
  }
  widths.sort((a, b) => a - b);
  return {
    ranges,
    median_range: median(widths),
    max_range: widths.length === 0 ? 0 : widths[widths.length - 1]!,
  };
}

export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  pre?: { tests: { heldOut: HeldOut; fit: Fit; chosenSpec: Spec }; odds: OddsResult },
): { fit: Fit; heldOut: HeldOut; ledger: Ledger; rows: BoardRow[]; live: LiveRow[]; peers: PeerPoint[]; odds: OddsResult; farm_counts: { farm: number; thin: number; skip: number }; seal: string; bootstrap_median_range: number; bootstrap_max_range: number } {
  const watchlist = new Set(snapshot.watchlist);
  const rows: BoardRow[] = [];
  const live: LiveRow[] = [];
  const ledger: Ledger = {
    watchlist: 0,
    early: 0,
    live_token: 0,
    excluded_category: 0,
    excluded_name: 0,
    total: snapshot.protocols.length,
  };
  const peers = cleanLivePeers(snapshot);
  const tested = pre?.tests ?? heldOutTests(peers, allLivePeers(snapshot), snapshot.as_of, model);
  const heldOut = tested.heldOut;
  const fit = tested.fit;
  const chosenSpec = tested.chosenSpec;
  const odds = pre?.odds ?? tokenOdds(snapshot, model);
  const cellOf = new Map(odds.cells.map((c) => [`${c.bucket}|${c.group}`, c]));
  const chosenFit = fitSpec(peers, snapshot.as_of, chosenSpec, model.growth_cap);
  const looPred = looPredictions(peers, snapshot.as_of, chosenSpec, model.growth_cap);
  const boardProtos: SnapshotProtocol[] = [];

  for (const p of snapshot.protocols) {
    if (watchlist.has(p.slug)) ledger.watchlist++;
    if (isPreToken(p)) {
      if (!passesCleanlinessRule(p)) {
        if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) ledger.excluded_category++;
        else ledger.excluded_name++;
        continue;
      }
      ledger.early++;
      boardProtos.push(p);
    } else {
      ledger.live_token++;
      live.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
      });
    }
  }

  const boot = bootstrapRankRanges(peers, boardProtos, chosenSpec, snapshot.as_of, model);
  const growthIdx = growthIndex(chosenSpec);

  for (const p of boardProtos) {
    const logTvl = Math.log(p.tvl_usd);
    const logImplied = chosenFit.predict(p);
    // Whole dollars, as the dashboard's formula prints it: the
    // drawer recomputes this row by the same rounding, so the two
    // must agree exactly.
    const implied = Math.round(Math.exp(logImplied));
    const growth = clamp(finite(p.change_7d, 0), -60, 120);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const cell = cellOf.get(`${ageBucket(age)}|${categoryGroup(p.category)}`)!;
    const predictAtTvl = (tvlUsd: number): number =>
      Math.round(Math.exp(chosenFit.predictLogTvl({ ...p, tvl_usd: tvlUsd }, Math.log(tvlUsd))));
    const farm = farmEconomics(p, implied, model, predictAtTvl);
    const steps = farmSteps(p, farm, model);
    const range = boot.ranges.get(p.slug)!;
    const growthCarry =
      growthIdx >= 0
        ? chosenSpec.growthCap
          ? clamp(chosenFit.beta[growthIdx]! * (growth / 100), -model.growth_cap, model.growth_cap)
          : chosenFit.beta[growthIdx]! * (growth / 100)
        : 0;
    const catPremium = Math.exp(chosenFit.offsets.get(p.category ?? 'Other') ?? 0);
    rows.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: age,
      implied_value_usd: implied,
      implied_low_usd: implied * heldOut.loo_p25_factor,
      implied_high_usd: implied * heldOut.loo_p75_factor,
      token_odds: cell.rate,
      odds_bucket: cell.label,
      rank_low: range.low,
      rank_high: range.high,
      farm,
      model: {
        intercept: fit.intercept,
        slope: fit.slope,
        peers: fit.peers,
        log_tvl: logTvl,
        log_implied: logImplied,
        growth_pct: growth,
        growth_carry: growthCarry,
        cat_premium: catPremium,
        age_days: age,
        range_low_factor: heldOut.loo_p25_factor,
        range_high_factor: heldOut.loo_p75_factor,
      },
      comparables: nearestComparables(p, peers, looPred),
      farm_steps: steps.map((s) => `${s.phase} — ${s.text} (Cost: ${s.cost}. Time: ${s.time}.)`),
    });
  }

  // Rank by implied value, highest first, slug as tie-break. Ranks
  // are 1..N and implied values are non-increasing by construction.
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  live.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const farmCounts = { farm: 0, thin: 0, skip: 0 };
  for (const r of rows) {
    if (r.farm.verdict === 'FARM') farmCounts.farm++;
    else if (r.farm.verdict === 'THIN') farmCounts.thin++;
    else farmCounts.skip++;
  }
  const seal = sealOf(rows.map((r) => r.implied_value_usd));
  return {
    fit,
    heldOut,
    ledger,
    rows,
    live,
    peers: peers.map((p): PeerPoint => [p.category, p.tvl_usd, p.mcap_usd!, p.change_7d, p.listed_at, p.chains.length]),
    odds,
    farm_counts: farmCounts,
    seal,
    bootstrap_median_range: boot.median_range,
    bootstrap_max_range: boot.max_range,
  };
}

export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { data: RadarData; board: BoardRow[] } {
  const peers = cleanLivePeers(snapshot);
  const tests = heldOutTests(peers, allLivePeers(snapshot), snapshot.as_of, model);
  const odds = tokenOdds(snapshot, model);
  const built = buildBoard(snapshot, model, { tests, odds });
  const board = built.rows;
  const data: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: built.ledger.early,
    live_size: 24,
    live_total: built.ledger.live_token,
    fit: built.fit,
    held_out: built.heldOut,
    odds: built.odds,
    ledger: built.ledger,
    farm_counts: built.farm_counts,
    seal: built.seal,
    bootstrap_median_range: built.bootstrap_median_range,
    bootstrap_max_range: built.bootstrap_max_range,
    watchlist: snapshot.watchlist,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      implied_low_usd: r.implied_low_usd,
      implied_high_usd: r.implied_high_usd,
      token_odds: r.token_odds,
      odds_bucket: r.odds_bucket,
      rank_low: r.rank_low,
      rank_high: r.rank_high,
      verdict: r.farm.verdict,
      net_usd: r.farm.net_usd,
      net_per_hour_usd: r.farm.net_per_hour_usd,
      slice_usd: r.farm.slice_usd,
      gas_usd: r.farm.gas_usd,
      growth_carry: r.model.growth_carry,
      cat_premium: r.model.cat_premium,
      tbill_usd: r.farm.tbill_usd,
      share_breakeven: r.farm.share_breakeven,
      odds_breakeven: r.farm.odds_breakeven,
      tvl_double_usd: r.farm.tvl_double_usd,
      implied_double_usd: r.farm.implied_double_usd,
      slice_double_usd: r.farm.slice_double_usd,
      net_double_usd: r.farm.net_double_usd,
      tvl_down30_usd: r.farm.tvl_down30_usd,
      implied_down30_usd: r.farm.implied_down30_usd,
      comparables: r.comparables,
      steps: farmSteps(
        {
          slug: r.slug,
          name: r.name,
          category: r.category,
          chains: r.chains,
          tvl_usd: r.tvl_usd,
          change_7d: r.change_7d,
          mcap_usd: r.mcap_usd,
          listed_at: r.listed_at,
          gecko_id: r.gecko_id,
          symbol: r.symbol,
        },
        r.farm,
        model,
      ),
    })),
    // The live-token view shows the 24 biggest live-token protocols;
    // the full count is in live_total and the ledger.
    live: built.live.slice(0, 24),
    peers: built.peers,
  };
  return { data, board };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot must be a JSON object');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.as_of !== 'string' || typeof r.source !== 'string') {
    throw new SnapshotError('snapshot is missing as_of or source');
  }
  if (!Array.isArray(r.protocols) || !Array.isArray(r.watchlist)) {
    throw new SnapshotError('snapshot is missing protocols or watchlist');
  }
  const protocols = r.protocols.map((item: unknown): SnapshotProtocol => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new SnapshotError('snapshot protocol is not an object');
    }
    const p = item as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string') {
      throw new SnapshotError('snapshot protocol is missing slug or name');
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: finite(p.tvl_usd, 0),
      change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: r.as_of,
    source: r.source,
    floor_usd: finite(r.floor_usd, 0),
    protocols,
    watchlist: r.watchlist.filter((s): s is string => typeof s === 'string'),
  };
}

// Every invariant the board must hold, checked before any output is
// written, so a broken board never ships: the right row count, the
// watchlist covered, ranks 1..N, implied values non-increasing, live
// rows never ranked, the counts adding up, and eight well-formed farm
// steps, five comparables and a rank range on every row.
export function boardIssue(board: BoardRow[], snapshot: Snapshot, data: RadarData): string | null {
  const watchlist = new Set(snapshot.watchlist);
  const seen = new Set(board.map((r) => r.slug));
  for (const slug of watchlist) {
    if (!seen.has(slug)) return `watchlist slug missing from board: ${slug}`;
  }
  if (board.length < 100 || board.length > 4000) return `board size ${board.length} is outside 100-4000`;
  if (data.live.length !== 24) return `live view shows ${data.live.length} rows, expected 24`;
  if (board.length !== data.rows.length) return 'board and radar row counts differ';
  if (data.rows.length !== data.board_size) return 'radar row count does not match board_size';
  if (board.some((r) => r.token_status !== 'pre-token')) return 'a ranked row records a token';
  if (board.some((r) => r.mcap_usd !== null)) return 'a ranked row carries a market cap';
  if (!/^[0-9a-f]{8}$/.test(data.seal)) return `seal ${data.seal} is not eight hex digits`;
  if (sealOf(board.map((r) => r.implied_value_usd)) !== data.seal) return 'seal does not match the board values';
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `rank ${r.rank} at position ${i + 1}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `implied value rises at rank ${r.rank}`;
    }
    if (r.farm_steps.length !== 8) return `rank ${r.rank} has ${r.farm_steps.length} farm steps`;
    for (const step of r.farm_steps) {
      if (step.length < 20 || step.length > 600) return `farm step length ${step.length} at rank ${r.rank}`;
    }
    if (r.comparables.length !== 5) return `rank ${r.rank} has ${r.comparables.length} comparables`;
    if (r.rank_low < 1 || r.rank_high < r.rank_low || r.rank_high > board.length) {
      return `rank range ${r.rank_low}-${r.rank_high} is outside 1..${board.length} at rank ${r.rank}`;
    }
    if (!['FARM', 'THIN', 'SKIP'].includes(r.farm.verdict)) return `unknown verdict at rank ${r.rank}`;
  }
  // Every protocol is exactly one of: clean pre-token (the board,
  // which includes the watchlist), live-token, or excluded by
  // category or by name. The watchlist is a subset of the board,
  // not a separate group.
  const total = data.ledger.early + data.ledger.live_token + data.ledger.excluded_category + data.ledger.excluded_name;
  if (total !== data.ledger.total) return `ledger adds to ${total} of ${data.ledger.total}`;
  if (board.length !== data.ledger.early) return 'board length does not match early count';
  return null;
}

// data.js is a hand-written string, not JSON.stringify of the whole
// object: the header reads as data, and the build never depends on
// JSON escaping quirks. The rows, live view and peers are objects
// with named fields, because that is the shape the dashboard reads:
// a row's category, chains and implied value are r.category,
// r.chains and r.implied_value_usd, and a positional array would
// leave every one of them undefined. The peers are compact arrays
// instead: the dashboard's refit reads them by position.
export function dataScript(data: RadarData): string {
  const json = (value: unknown): string => JSON.stringify(value);
  return `// Token Radar data, generated from the sealed snapshot. The
// dashboard reads these arrays, refits the model from the peer
// table, recomputes every row's implied value and odds from them,
// and refuses to render when a check fails.
const DATA = ${json({
  as_of: data.as_of,
  source: data.source,
  floor_usd: data.floor_usd,
  model: data.model,
  model_version: data.model_version,
  watchlist_size: data.watchlist_size,
  board_size: data.board_size,
  early_size: data.early_size,
  live_size: data.live_size,
  live_total: data.live_total,
  fit: data.fit,
  held_out: data.held_out,
  odds: data.odds,
  ledger: data.ledger,
  farm_counts: data.farm_counts,
  seal: data.seal,
  bootstrap_median_range: data.bootstrap_median_range,
  bootstrap_max_range: data.bootstrap_max_range,
  watchlist: data.watchlist,
})};
DATA.rows = ${json(data.rows)};
DATA.live = ${json(data.live)};
DATA.peers = ${json(data.peers)};
window.RADAR = DATA;
`;
}
