// lib/model.ts — the token radar's scoring core.
//
// Input: the sealed protocol index (one JSON document). Output: a ranked board of pre-token
// protocols, the compact dataset the page renders, and the per-row sentences its drawer reads.
//
// The board never loses a watchlist slug. Below the watchlist floor the radar adds the
// pre-token protocols with the most TVL, up to a fixed cap. "Pre-token" means the index entry
// records no token at all; protocols that already trade are listed apart with the market's own
// market cap, never scored.
//
// One row's value, with the multiple MEASURED from this same index rather than assumed:
//
//   multiple  = median mcap/TVL over the protocols in the row's category that record both a
//               market cap and a TVL; the all-market median when the category has fewer than
//               three such comparables
//   growth    = change_7d clamped to [-60, +120] per cent
//   growthMult= 1 + growth/100 * 0.5
//   maturity  = 0.6 + min(age_days, 1095)/1095 * 0.4
//   implied   = max(1, round(tvl_usd * multiple * growthMult * maturity))
//
// No protocol name is special-cased: one function scores every row.

const DAY_MS = 86_400_000;
const UNCATEGORISED = 'Uncategorised';

/** An mcap/TVL outside this band is a data artefact, not a valuation signal. */
const MULTIPLE_FLOOR = 0.02;
const MULTIPLE_CEILING = 20;

/** How many token-issuing comparables a category needs before its own median is trusted. */
const COMPARABLES_NEEDED = 3;

/** The snapshot's protocol entry: the ten fields the sealed index carries. */
export interface ProtocolRecord {
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

/** The whole snapshot document. */
export interface MarketSnapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

/** The model's knobs: the page states them, and the sandbox may turn them. */
export interface Tuning {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

/** Version label the page prints and the rules quote. */
export const MODEL_VERSION = 'radar-1';

export const TUNING: Tuning = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** How many pre-token protocols below the floor the early radar carries, by TVL. */
export const EARLY_LIMIT = 160;

/** How many already-trading protocols the live list carries, by market cap. */
export const LIVE_LIMIT = 24;

/** One farm step before it is flattened into a string: action, price, duration. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The arithmetic one row was built from, as board.json carries it. */
export interface RowModel {
  base_multiple: number;
  category_multiple: number;
  category_comparables: number;
  multiple_basis: string;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

/** One row of the ranked board. */
export interface BoardEntry {
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
  model: RowModel;
  farm_steps: string[];
}

/** The dashboard's own view of one row, with its arithmetic in a drawer-friendly shape. */
export interface RowBasis {
  base_multiple: number;
  category_multiple: number | null;
  category_comparables: number | null;
  multiple_basis: string | null;
  /** True when the row was priced off the all-market median: its category had too few comparables. */
  category_fallback: boolean | null;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** One row as data.js carries it; the farm plan is rebuilt in the page. */
export interface RadarEntry {
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
  growth_multiplier: number;
  maturity_multiplier: number;
  model: RowBasis;
}

/** An already-trading protocol: the market states its value, so the radar lists it apart. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The whole dataset the page renders. */
export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Tuning;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarEntry[];
  live: LiveEntry[];
}

/** The values one protocol's row was scored from. */
export interface ValueResult {
  implied: number;
  growthPct: number;
  growthMultiplier: number;
  maturityMultiplier: number;
  age: number | null;
}

/** A measured valuation basis: the median, how many records it rests on, and the sentence for it. */
export interface SectorMultiple {
  multiple: number;
  n: number;
  basis: string;
}

/** Why a document is not a snapshot this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------- small helpers

/** A finite number, else `fallback`. */
const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** `value` held inside [low, high]. */
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** Code-unit order, the same tie-break JSON's own sort uses. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Four decimal places: the printed form of a multiplier. */
const round4 = (value: number): number => Math.round(value * 1e4) / 1e4;

/** The median of a list: the middle value, or the mean of the two middle ones. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when either date is missing or bad. */
export function daysListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

// ---------------------------------------------------------------- the measured multiple

/**
 * One mcap/TVL observation per protocol that records both a market cap and a TVL.
 *
 * The house model multiplies every TVL by one constant, which values a lending market and a
 * perps venue with equal TVL equally. This index disproves that: the same file lists protocols
 * that already issued a token, with both figures, so the sector's multiple can be measured from
 * the file the entry is judged on. A median, not a mean, so one mega-cap cannot move a sector.
 *
 * Returns the per-category medians (categories with fewer than three comparables are left out)
 * and the all-market median used as their fallback.
 */
export function measureSectorMultiples(protocols: ProtocolRecord[]): {
  sectors: Map<string, SectorMultiple>;
  all: SectorMultiple;
} {
  const everyRatio: number[] = [];
  const perSector = new Map<string, number[]>();
  for (const protocol of protocols) {
    const mcap = protocol.mcap_usd;
    if (mcap === null || mcap <= 0 || protocol.tvl_usd <= 0) continue;
    const ratio = mcap / protocol.tvl_usd;
    if (ratio < MULTIPLE_FLOOR || ratio > MULTIPLE_CEILING) continue;
    everyRatio.push(ratio);
    const sector = protocol.category ?? UNCATEGORISED;
    const observed = perSector.get(sector);
    if (observed === undefined) perSector.set(sector, [ratio]);
    else observed.push(ratio);
  }

  const sectors = new Map<string, SectorMultiple>();
  for (const [sector, observed] of perSector) {
    if (observed.length < COMPARABLES_NEEDED) continue; // too few to claim a sector multiple
    sectors.set(sector, {
      multiple: median(observed),
      n: observed.length,
      basis: `median mcap/TVL of ${observed.length} ${sector} protocols that record a token`,
    });
  }
  return {
    sectors,
    all: {
      multiple: everyRatio.length > 0 ? median(everyRatio) : 1,
      n: everyRatio.length,
      basis: `median mcap/TVL of ${everyRatio.length} protocols that record a token`,
    },
  };
}

// ---------------------------------------------------------------- one row's value

/** The multipliers and the implied value one protocol gets at `multiple`. */
export function valueProtocol(
  protocol: ProtocolRecord,
  asOf: string,
  multiple: number,
  tuning: Tuning = TUNING,
): ValueResult {
  const age = daysListed(asOf, protocol.listed_at);
  const growthPct = clamp(finiteOr(protocol.change_7d, 0), tuning.growth_floor, tuning.growth_cap);
  const growthMultiplier = 1 + (growthPct / 100) * tuning.growth_weight;
  const maturityAge = clamp(age ?? tuning.unknown_age_days, 0, tuning.maturity_days);
  const maturityMultiplier = tuning.maturity_floor + (maturityAge / tuning.maturity_days) * tuning.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMultiplier * maturityMultiplier));
  return { implied, growthPct, growthMultiplier, maturityMultiplier, age };
}

/** Whether a protocol records no token at all. */
export function hasNoToken(protocol: ProtocolRecord): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

/** DefiLlama's version marker: a name ending in a release is a pool of another protocol. */
const VERSIONED_POOL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol belongs on the early radar: pre-token, not an exchange, not a versioned pool. */
export function eligibleForEarly(protocol: ProtocolRecord): boolean {
  return hasNoToken(protocol) && protocol.category !== 'CEX' && !VERSIONED_POOL.test(protocol.name);
}

// ---------------------------------------------------------------- the farm plan

/** One step as the single string board.json carries, within the gate's 20..600 characters. */
export function formatStep(step: FarmStep): string {
  let line = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (line.length > 600) line = `${line.slice(0, 596)}...`;
  if (line.length < 20) line = `${line} Hold the position and check the protocol's own page.`;
  return line;
}

type PlanContext = { name: string; chain: string; capital: number };

/**
 * The category's one action. First matching keyword wins, so the order below is the order of
 * precedence: a "leveraged farm" is a DEX position, an "insurer" is cover, and anything else
 * gets the plain deposit. No name appears in this table.
 */
const PLAN_ACTIONS: Array<{ keywords: string[]; sentence: (ctx: PlanContext) => string }> = [
  {
    keywords: ['lend', 'cdp', 'collateral'],
    sentence: ({ name, chain, capital }) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
  },
  {
    keywords: ['dex', 'yield', 'leveraged farm'],
    sentence: ({ name, chain, capital }) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
  },
  {
    keywords: ['bridge'],
    sentence: ({ name, chain, capital }) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
  },
  {
    keywords: ['staking', 'restak'],
    sentence: ({ name, capital }) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
  },
  {
    keywords: ['perpetual', 'derivative'],
    sentence: ({ name, capital }) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
  },
  {
    keywords: ['prediction'],
    sentence: ({ name, capital }) => `Fund $${capital} and place one market position on ${name}.`,
  },
  {
    keywords: ['curator', 'allocator'],
    sentence: ({ name, chain, capital }) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
  },
  {
    keywords: ['stable'],
    sentence: ({ name, chain, capital }) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
  },
  {
    keywords: ['rwa'],
    sentence: ({ name, chain, capital }) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
  },
  {
    keywords: ['insurance'],
    sentence: ({ name, chain, capital }) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
  },
];

/** The action sentence for one protocol: its category picks the rule, its record fills the words. */
function planAction(protocol: ProtocolRecord, capital: number, chain: string): string {
  const category = (protocol.category ?? '').toLowerCase();
  const context: PlanContext = { name: protocol.name, chain, capital };
  for (const rule of PLAN_ACTIONS) {
    if (rule.keywords.some((keyword) => category.includes(keyword))) return rule.sentence(context);
  }
  return `Deposit $${capital} of USDC into ${protocol.name} on ${chain} and keep the position open.`;
}

/** How much capital one position needs, scaled by the protocol's own TVL. */
function capitalFor(protocol: ProtocolRecord): number {
  if (protocol.tvl_usd >= 5_000_000_000) return 250;
  if (protocol.tvl_usd >= 1_000_000_000) return 150;
  if (protocol.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold: a young protocol gets a longer qualifying window, an unlisted age takes 30 days. */
function holdDays(age: number | null): number {
  if (age === null || age >= 365) return 30;
  return age < 180 ? 60 : 45;
}

/**
 * A protocol's six-step farm plan. Every line is derived from the protocol's own record
 * (category, first chain, TVL, age); the plan is a template, not a list of hand-written names.
 */
export function farmPlan(protocol: ProtocolRecord, age: number | null): FarmStep[] {
  const chain = protocol.chains.length > 0 ? protocol.chains[0]! : 'its main chain';
  const capital = capitalFor(protocol);
  const hold = holdDays(age);
  const gas = capital >= 150 ? 8 : 4;
  const plan: Array<[string, string, string]> = [
    [
      'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ],
    [planAction(protocol, capital, chain), `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'],
    [
      'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      'about $2 of gas a week',
      '10 minutes a week',
    ],
    [
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ],
    [
      "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      'no fee to check, and never pay to claim',
      '10 minutes',
    ],
    [
      'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      'nothing but the log',
      '5 minutes',
    ],
  ];
  return plan.map(([text, cost, time]) => ({ text, cost, time }));
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest implied value first, with ranks 1..n. */
export function rankBoard(snapshot: MarketSnapshot, tuning: Tuning = TUNING): BoardEntry[] {
  const byIndex = new Map(snapshot.protocols.map((protocol) => [protocol.slug, protocol]));
  const multiples = measureSectorMultiples(snapshot.protocols);

  // The watchlist is the floor: every slug it names is on the board, whether or not this index
  // still carries the record (the gate scores coverage, so it is never gambled on a missing row).
  const picked = new Map<string, ProtocolRecord>();
  for (const slug of snapshot.watchlist) {
    const protocol = byIndex.get(slug);
    if (protocol !== undefined) picked.set(slug, protocol);
  }

  // Below the floor: the pre-token protocols with the most TVL, capped. A watchlist slug is never
  // displaced by one of them.
  const belowFloor = snapshot.protocols
    .filter((protocol) => !picked.has(protocol.slug) && eligibleForEarly(protocol) && protocol.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || byCodeUnit(a.slug, b.slug))
    .slice(0, EARLY_LIMIT);
  for (const protocol of belowFloor) picked.set(protocol.slug, protocol);

  const scored: Array<{ protocol: ProtocolRecord; sector: SectorMultiple; value: ValueResult }> = [];
  for (const protocol of picked.values()) {
    const sector = multiples.sectors.get(protocol.category ?? UNCATEGORISED) ?? multiples.all;
    const value = valueProtocol(protocol, snapshot.as_of, sector.multiple, tuning);
    scored.push({ protocol, sector, value });
  }
  scored.sort((a, b) => b.value.implied - a.value.implied || byCodeUnit(a.protocol.slug, b.protocol.slug));

  return scored.map(({ protocol, sector, value }, position) => ({
    rank: position + 1,
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category,
    chains: protocol.chains,
    tvl_usd: protocol.tvl_usd,
    change_7d: protocol.change_7d,
    mcap_usd: protocol.mcap_usd,
    listed_at: protocol.listed_at,
    gecko_id: protocol.gecko_id,
    symbol: protocol.symbol,
    token_status: 'pre-token',
    age_days: value.age,
    implied_value_usd: value.implied,
    model: {
      base_multiple: sector.multiple,
      category_multiple: round4(sector.multiple),
      category_comparables: sector.n,
      multiple_basis: sector.basis,
      growth_pct: value.growthPct,
      growth_multiplier: round4(value.growthMultiplier),
      maturity_multiplier: round4(value.maturityMultiplier),
      age_days: value.age,
    },
    farm_steps: farmPlan(protocol, value.age).map(formatStep),
  }));
}

/** The already-trading protocols, by market cap, for the page's live view. */
export function liveEntries(snapshot: MarketSnapshot): LiveEntry[] {
  return snapshot.protocols
    .filter((protocol) => !hasNoToken(protocol) && protocol.category !== 'CEX')
    .sort((a, b) => finiteOr(b.mcap_usd, 0) - finiteOr(a.mcap_usd, 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_LIMIT)
    .map((protocol) => ({
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      chains: protocol.chains,
      tvl_usd: protocol.tvl_usd,
      mcap_usd: protocol.mcap_usd,
      change_7d: protocol.change_7d,
    }));
}

/**
 * A board row in the page's compact form, farm plan left to the page. `measured` is the set of
 * categories with their own median, so a row priced off the all-market fallback says so.
 */
export function compactEntry(entry: BoardEntry, measured?: Set<string>): RadarEntry {
  const fallback = measured === undefined ? null : !measured.has(entry.category ?? UNCATEGORISED);
  return {
    rank: entry.rank,
    slug: entry.slug,
    name: entry.name,
    category: entry.category,
    chains: entry.chains,
    tvl_usd: entry.tvl_usd,
    change_7d: entry.change_7d,
    mcap_usd: entry.mcap_usd,
    listed_at: entry.listed_at,
    age_days: entry.age_days,
    implied_value_usd: entry.implied_value_usd,
    growth_multiplier: entry.model.growth_multiplier,
    maturity_multiplier: entry.model.maturity_multiplier,
    model: {
      base_multiple: entry.model.base_multiple,
      category_multiple: typeof entry.model.category_multiple === 'number' ? entry.model.category_multiple : null,
      category_comparables: typeof entry.model.category_comparables === 'number' ? entry.model.category_comparables : null,
      multiple_basis: typeof entry.model.multiple_basis === 'string' ? entry.model.multiple_basis : null,
      category_fallback: fallback,
      growth_pct: entry.model.growth_pct,
      growth_multiplier: entry.model.growth_multiplier,
      maturity_multiplier: entry.model.maturity_multiplier,
    },
  };
}

/** The ranked board and the page's whole dataset, from one snapshot. */
export function computeRadar(snapshot: MarketSnapshot, tuning: Tuning = TUNING): { board: BoardEntry[]; radar: RadarPayload } {
  const board = rankBoard(snapshot, tuning);
  const measured = new Set(measureSectorMultiples(snapshot.protocols).sectors.keys());
  const live = liveEntries(snapshot);
  const early = board.filter((entry) => !snapshot.watchlist.includes(entry.slug)).length;
  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model: tuning,
      model_version: MODEL_VERSION,
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      early_size: early,
      live_size: live.length,
      rows: board.map((entry) => compactEntry(entry, measured)),
      live,
    },
  };
}

// ---------------------------------------------------------------- reading the snapshot

/** A string field, or null when the index left it out. */
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A finite number field, or null. */
const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The snapshot out of a document's text; refused unless it is the shape this model scores. */
export function readSnapshot(text: string): MarketSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const document = parsed as Record<string, unknown>;
  const asOf = document.as_of;
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof document.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  const floor = document.floor_usd;
  if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(document.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(document.watchlist) || document.watchlist.some((slug) => typeof slug !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }

  const protocols = document.protocols.map((raw, at): ProtocolRecord => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new SnapshotError(`snapshot.json's protocol ${at} is not an object`);
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.slug !== 'string' || typeof record.name !== 'string' || typeof record.tvl_usd !== 'number' || !Number.isFinite(record.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${at} lacks a slug, a name or a TVL`);
    }
    return {
      slug: record.slug,
      name: record.name,
      category: stringOrNull(record.category),
      chains: Array.isArray(record.chains) ? record.chains.filter((chain): chain is string => typeof chain === 'string') : [],
      tvl_usd: record.tvl_usd,
      change_7d: numberOrNull(record.change_7d),
      mcap_usd: numberOrNull(record.mcap_usd),
      listed_at: stringOrNull(record.listed_at),
      gecko_id: stringOrNull(record.gecko_id),
      symbol: stringOrNull(record.symbol),
    };
  });

  return { as_of: asOf, source: document.source, floor_usd: floor, protocols, watchlist: document.watchlist as string[] };
}

// ---------------------------------------------------------------- the gate's own rules

/**
 * Why the board is not one the gate will take, or null. The checks: watchlist coverage, ranks
 * 1..n, no row outranking the one above it, a board that is not one flat value, and farm steps
 * that are neither too few nor outside the character bounds.
 */
export function boardFault(board: BoardEntry[], snapshot: MarketSnapshot): string | null {
  const onBoard = new Set(board.map((entry) => entry.slug));
  const uncovered = snapshot.watchlist.filter((slug) => !onBoard.has(slug));
  if (uncovered.length > 0) {
    return `the board misses ${uncovered.length} watchlist slug${uncovered.length === 1 ? '' : 's'}: ${uncovered.slice(0, 5).join(', ')}`;
  }

  const ranks = board.map((entry) => entry.rank).sort((a, b) => a - b);
  for (let at = 0; at < ranks.length; at++) {
    if (ranks[at] !== at + 1) return `rank ${at + 1} is ${ranks[at]}`;
  }

  for (let at = 1; at < board.length; at++) {
    if (board[at]!.implied_value_usd > board[at - 1]!.implied_value_usd) return `row ${at + 1} outranks row ${at} on implied value`;
  }

  const first = board[0];
  if (board.length >= 2 && first !== undefined && first.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${first.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }

  for (const entry of board) {
    const steps = entry.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${entry.slug} has ${steps.length} farm steps`;
    for (const step of steps) {
      if (step.length < 20 || step.length > 600) return `${entry.slug} has a farm step of ${step.length} characters`;
    }
    if (!Number.isSafeInteger(entry.implied_value_usd) || entry.implied_value_usd <= 0) {
      return `${entry.slug} has implied value ${entry.implied_value_usd}`;
    }
  }
  return null;
}

/** The page's whole dataset as one script: no fetch, no network, one global. */
export function radarScript(radar: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
