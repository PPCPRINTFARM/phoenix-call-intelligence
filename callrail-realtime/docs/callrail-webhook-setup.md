# CallRail webhook setup

CallRail's "post-call" webhook fires within 5–10 seconds of every call ending — that's our trigger for the realtime ingest.

## 1. Get the n8n webhook URL

After importing `workflow/callrail-realtime-ingest.json` into n8n Cloud:

```
https://phoenixphaseconverters.app.n8n.cloud/webhook/callrail-realtime-ingest
```

(Activate the workflow first or it'll 404.)

## 2. Configure CallRail

1. Sign in to [app.callrail.com](https://app.callrail.com)
2. Pick the Phoenix Phase Converters account (ID `906309465`)
3. **Settings → Integrations → Webhooks**
4. Click **Add webhook** with these values:

   | Field | Value |
   |---|---|
   | Trigger | **Post Call** |
   | URL | `https://phoenixphaseconverters.app.n8n.cloud/webhook/callrail-realtime-ingest` |
   | Format | JSON |
   | HTTP Method | POST |
   | Companies | All Phoenix Phase Converters numbers |

5. Click **Save**.

## 3. Verify

Make a 30-second test call to one of your tracking numbers. Within ~45 seconds:

- The Pushover notification should land on your iPhone with the AI one-liner
- `~/phoenix-hub/logs/*.log` should show the ingest hit
- `sqlite3 ~/phoenix-hub/data/hub.db "SELECT id, caller_name, summary FROM events WHERE source='callrail' ORDER BY timestamp DESC LIMIT 1;"` should show the call
- Asking ChatGPT *"who called in the last 5 minutes?"* should now find it

## How this coexists with the existing v2 workflow

Your existing **Phoenix Call Intelligence v2** workflow is *also* listening on a CallRail webhook (`callrail-intelligence-v2`) — it builds the Telegram action card with Quote/Email/SMS buttons. That stays untouched.

CallRail lets you configure multiple webhooks for the same trigger, so both fire in parallel:

| Webhook | URL | Purpose |
|---|---|---|
| Existing v2 | `https://phoenixphaseconverters.app.n8n.cloud/webhook/callrail-intelligence-v2` | Telegram action card (60s wait) |
| **NEW realtime ingest** | `https://phoenixphaseconverters.app.n8n.cloud/webhook/callrail-realtime-ingest` | hub.db insert + Pushover (30s wait) |

The new one is faster (30s vs 60s) and writes to hub.db so the MCP server, dashboards, and customer-lookup PWA all see the call right away.

## Retry behavior

CallRail retries up to 3 times with exponential backoff if your webhook returns a non-2xx response. The hub.db ingest endpoint is idempotent (UPSERT on call ID), so a retry is safe — it'll update the existing row rather than create a duplicate.
