# Meridian flow logs

Artifacts from live Seaport DevNet end-to-end runs (invoice → financing → DvP award → syndication → waterfall repayment).

| File | Purpose |
|------|---------|
| [TRANSACTIONS.md](./TRANSACTIONS.md) | Explorer link table for every ledger update in the latest run |
| [full-flow-latest.md](./full-flow-latest.md) | Human-readable step log (latest) |
| [full-flow-latest.json](./full-flow-latest.json) | Machine-readable step log (latest) |
| `full-flow-<timestamp>.*` | Timestamped copies of the same run |

## How to regenerate

```bash
pnpm redstone:fetch          # fresh SOFR oracle snapshot required
pnpm capture:flow:logs       # submits the full flow and writes this folder
```

Script: [`scripts/capture-full-flow-logs.ts`](https://github.com/Marshal-AM/meridian/blob/main/scripts/capture-full-flow-logs.ts)

Explorer base: [https://lighthouse.devnet.cantonloop.com](https://lighthouse.devnet.cantonloop.com)

Canton transaction IDs are Ledger API `updateId` values from `submit-and-wait-for-transaction`. Explorer URLs use the same path pattern as the portal (`apps/portal/src/lib/canton-explorer.ts`).
