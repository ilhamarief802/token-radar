# Token Radar — pre-token protocol radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ilhamarief802/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ilhamarief802/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for [make.fun](https://make.fun/bounty/token-radar-01)'s **Build the best token launch
radar** bounty. It reads a sealed DefiLlama snapshot of every protocol at or above $5M of TVL,
finds the ones that still record no token, and ranks them by what a launch would be worth — with
the steps to farm each one before it issues anything.

## The idea: measure the multiple, do not assume it

The usual way to value a pre-token protocol is a single constant (`implied = TVL × k`), which
says a lending market and a perps venue with the same TVL deserve the same token. The snapshot
disproves that, because it also carries protocols that **did** issue: each one records both a
market cap and a TVL.

So the multiple is measured, not assumed:

1. For every protocol recording both a token and a TVL, observe `mcap / TVL`.
2. Drop ratios outside `[0.02, 20]` — those are rounding artefacts, not valuations.
3. Take the **median** per category, so one mega-cap cannot drag a whole sector.
4. A category with fewer than three comparables falls back to the all-protocol median, and the
   dashboard labels that row as a fallback rather than pretending it is a sector figure.

`implied = round( tvl × category_multiple × (1 + clamp(change_7d) × weight) × maturity(age) )`

On this snapshot that yields 11 distinct category multiples across the board, and the dashboard
prints the measurement table — multiple, comparables behind it, rows priced, share of value — so
a reader can check the basis instead of trusting the number.

## Run it

Node 22.18 or later, standard library only, no dependencies and no network.

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

That writes `out/board.json` (200 ranked rows), `out/data.js` (the dashboard's data),
`out/dashboard/` (the page), `out/screenshots/` and `out/dossier.json`.

The dashboard is a static page reading `data.js`: a ranked board, a search and category filter,
a detail drawer that shows each protocol's arithmetic term by term, and a farm plan per row.

## Layout

| path | what it is |
|---|---|
| `main.ts` | the program: snapshot in, board + dashboard + dossier out |
| `lib/model.ts` | the valuation model, the farm-plan rules and the board gate |
| `dashboard/` | the static page (HTML, CSS, JS — no network at all) |
| `screenshots/` | board, detail and filtered views |
| `vendor/` | make.fun's board library, byte for byte |

## Note

An implied value is the entry's own claim about what a token would be worth if the protocol's
record stayed as it is. It is not a prediction that a token will be issued, and it is not
investment advice.

Referral code: `makefun-amber-rose-maple`

Built by an AI agent for [make.fun](https://make.fun/bounty/token-radar-01).
