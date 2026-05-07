# CallRail → hub.db Realtime Ingest

Inserts every CallRail post-call event into hub.db within ~35 seconds of hang-up, and pushes a one-sentence AI summary to your iPhone via Pushover. The MCP server's `callrail_recent` (and every other consumer of hub.db) sees new calls without waiting for the next scheduled sync.

## Architecture

```
CallRail (post-call webhook)
        │
        ▼
n8n Cloud workflow (this repo)
        │  fetch transcript, AI-summarize, upsert
        ▼
Phoenix Hub Express API (port 4821, Mac Studio)
        │  /api/ingest/callrail — UPSERT to events + customers
        ▼
hub.db (SQLite, WAL mode)
        ▲
        │  queried by:
        ├─ ChatGPT MCP server (callrail_recent, get_customer_history)
        ├─ Phoenix Call Screener PWA
        ├─ Realtime Dashboard
        └─ Customer Lookup app

(in parallel)
n8n workflow → Pushover → iPhone
```

## What's in this folder

| Path | Purpose |
|---|---|
| `workflow/callrail-realtime-ingest.json` | n8n workflow JSON, ready to import |
| `hub-api/ingest_callrail.js` | Express router that mounts at `/api/ingest/callrail` on Phoenix Hub |
| `hub-api/install.md` | How to install the API endpoint on Mac Studio |
| `docs/callrail-webhook-setup.md` | How to configure CallRail to POST to n8n |
| `docs/pushover-setup.md` | One-time Pushover setup for iPhone push notifications |
| `docs/n8n-import.md` | Importing the workflow + wiring credentials |

## Install order

1. **Hub API** — drop `ingest_callrail.js` into Phoenix Hub, mount it, restart the LaunchAgent. (`hub-api/install.md`)
2. **n8n workflow** — import the JSON, fix 3 placeholders (Anthropic credential, Pushover token, Pushover user key), activate. (`docs/n8n-import.md`)
3. **CallRail webhook** — add a Post Call webhook pointed at the n8n URL. (`docs/callrail-webhook-setup.md`)
4. **Pushover** — sign up, install the iPhone app, paste tokens into the n8n node. (`docs/pushover-setup.md`)
5. **Test** — make a 30-second call to a tracking number. Push lands in ~40 seconds; row in hub.db.

## Coexists with existing v2 workflow

The existing **Phoenix Call Intelligence v2** workflow (Telegram action cards) keeps running unchanged. CallRail fires both webhooks in parallel — Telegram card on one path, hub.db ingest + push on the other. No conflicts.

## Push notification design

```
📞 Inbound · Mac Reed · 4 min
Mac Reed asks for a 40HP quote on a 4820 for a cabinet shop, sounds ready to move.

3× caller · $7,863 lifetime
```

Tap the notification → opens the call in CallRail.

## Idempotent ingestion

The hub.db endpoint UPSERTs on the CallRail call ID. CallRail occasionally retries webhooks; retries update the existing row rather than create duplicates.

## Latency budget

| Stage | Time |
|---|---|
| CallRail fires webhook after hang-up | ~5 s |
| Wait for transcript | 30 s |
| Fetch + normalize + Claude Haiku | 2–4 s |
| hub.db UPSERT | <100 ms |
| Pushover delivery | 1–3 s |
| **Total: hang-up → iPhone push** | **~38–45 s** |

For voicemails and missed calls, the wait can be reduced to 5s (no transcript to wait for) — see `docs/n8n-import.md` for the optional optimization.
