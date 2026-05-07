# Import the workflow into n8n Cloud

## Quick path (UI)

1. Sign in to [phoenixphaseconverters.app.n8n.cloud](https://phoenixphaseconverters.app.n8n.cloud)
2. **Workflows → Add Workflow → Import from File**
3. Select `workflow/callrail-realtime-ingest.json`
4. Three placeholders to fix before activating:

   | Node | What to change |
   |---|---|
   | **Claude Haiku - One-Sentence Summary** | `credentials.anthropicApi.id` → pick your existing Anthropic credential from the dropdown (you already have one for the v2 workflow) |
   | **Send Pushover Notification** | `REPLACE_PUSHOVER_APP_TOKEN` → your Pushover application token |
   | **Send Pushover Notification** | `REPLACE_PUSHOVER_USER_KEY` → your Pushover user key |

5. Activate the workflow (toggle in the top-right).

## API path

```bash
N8N_API_KEY="your-api-key"

# Import
curl -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d @workflow/callrail-realtime-ingest.json \
  https://phoenixphaseconverters.app.n8n.cloud/api/v1/workflows

# Note the returned workflow ID, then activate
curl -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  https://phoenixphaseconverters.app.n8n.cloud/api/v1/workflows/$WORKFLOW_ID/activate
```

You'll still need to wire credentials and replace the Pushover placeholders via the UI.

## Why a 30-second wait?

CallRail transcribes calls asynchronously. The post-call webhook fires immediately on hang-up, but the `transcription` field is usually empty for ~10–20 seconds while the audio is being processed. Waiting 30 seconds gives us a high hit rate on transcripts without making the push notification feel laggy. If the transcript is still missing at 30s (rare, only on long calls), the workflow falls back to CallRail's own `call_summary` field for the AI summary.

## What the workflow does, end to end

```
   CallRail post-call webhook
            │
            ▼
   ① Extract call ID
            │
            ▼
   ② Wait 30 seconds  (let CallRail finish transcribing)
            │
            ▼
   ③ Fetch full call (id, transcription, summary, customer)
            │
            ▼
   ④ Normalize: clean phone, drop geo placeholders
            │
            ▼
   ⑤ Claude Haiku 4.5 → one-sentence summary
            │
            ▼
   ⑥ Merge AI summary back onto call data
            │
            ▼
   ⑦ POST /api/ingest/callrail (Phoenix Hub) — UPSERTs into hub.db
            │       returns customer record (name, total_calls, $ lifetime)
            ▼
   ⑧ Build Pushover payload (title, body, priority, deep-link URL)
            │
            ▼
   ⑨ Send Pushover → iPhone push lands in 1–3s
            │
            ▼
   ⑩ Return 200 OK to CallRail
```

Total wall-clock from hang-up to push notification on your phone: about **35–45 seconds**, dominated by the 30s transcript wait.
