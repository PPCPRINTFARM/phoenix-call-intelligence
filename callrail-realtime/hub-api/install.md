# Phoenix Hub — `ingest_callrail.js` install

The new realtime ingest endpoint lives in your existing Phoenix Hub Express server (port 4821). Drop in the file, mount the router, restart the service, done.

## Steps

1. **Copy the file** to the Phoenix Hub project on Mac Studio:
   ```bash
   cp callrail-realtime/hub-api/ingest_callrail.js \
      ~/phoenix-hub/src/routes/ingest_callrail.js
   ```

2. **Install the dependency** if `better-sqlite3` isn't already in the Phoenix Hub `package.json`:
   ```bash
   cd ~/phoenix-hub
   npm install better-sqlite3 express
   ```

3. **Mount the router** in your main Phoenix Hub app file (typically `~/phoenix-hub/src/server.js` or `~/phoenix-hub/index.js`). Add this line near the other `app.use(...)` mounts:
   ```js
   app.use(require('./routes/ingest_callrail'));
   ```

4. **Restart the Phoenix Hub LaunchAgent** (or however you run it):
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.phoenix.hub.plist
   launchctl load ~/Library/LaunchAgents/com.phoenix.hub.plist
   ```

5. **Smoke test** locally:
   ```bash
   curl -s http://127.0.0.1:4821/api/ingest/callrail/health \
        -H "X-API-Key: phoenix-hub-2026"
   # → {"ok":true,"eventCount":74576}
   ```

   Then a sample insert:
   ```bash
   curl -s -X POST http://127.0.0.1:4821/api/ingest/callrail \
     -H "X-API-Key: phoenix-hub-2026" \
     -H "Content-Type: application/json" \
     -d '{
       "callId": "CALtest12345",
       "phone": "+15551234567",
       "trackingPhone": "+18889627880",
       "callerName": "Test Caller",
       "city": "Phoenix",
       "state": "AZ",
       "direction": "inbound",
       "duration": 120,
       "answered": true,
       "voicemail": false,
       "startTime": "2026-05-07T10:00:00-07:00",
       "transcript": "Caller: hi this is a test\nGlen: hello",
       "callRailSummary": "Test call",
       "aiOneSentence": "Test caller phoning to verify ingest path."
     }'
   # → {"ok":true,"eventId":"CALtest12345",...}
   ```

   Verify the row exists:
   ```bash
   sqlite3 ~/phoenix-hub/data/hub.db \
     "SELECT id, caller_name, summary FROM events WHERE id='CALtest12345';"
   ```
   Then clean up:
   ```bash
   sqlite3 ~/phoenix-hub/data/hub.db "DELETE FROM events WHERE id='CALtest12345';"
   sqlite3 ~/phoenix-hub/data/hub.db "DELETE FROM customers WHERE phone='+15551234567';"
   ```

6. **Expose it externally** so n8n Cloud can reach it. Phoenix Hub already runs behind your Tailscale Funnel at `https://glens-mac-studio-2.tailca8899.ts.net` per the existing Phoenix Call Intelligence v2 workflow — the new endpoint is automatically reachable at:

   ```
   POST https://glens-mac-studio-2.tailca8899.ts.net/api/ingest/callrail
   ```

## Why a single writer?

hub.db lives on the Mac Studio. SQLite handles concurrent readers fine (WAL mode), but multiple writers from different processes can cause `database is locked` errors — especially when n8n Cloud, the existing call-screener PWA, and the new MCP server are all hitting it at once. Funneling all writes through Phoenix Hub's Express server keeps things sane and lets us add validation, dedup, and retries in one place.
