/**
 * Phoenix Hub API — POST /api/ingest/callrail
 *
 * Receives a normalized CallRail call from n8n and writes it into hub.db
 * immediately. The MCP server's `callrail_recent` and the rest of the CRM
 * see the call within a second of hang-up instead of waiting for the next
 * scheduled CallRail sync.
 *
 * This module exports an Express router. Mount it in your existing
 * Phoenix Hub server (port 4821) like:
 *
 *     const callrailIngest = require('./ingest_callrail');
 *     app.use(callrailIngest);
 *
 * SECURITY: requires X-API-Key header matching env PHOENIX_HUB_API_KEY
 * (default 'phoenix-hub-2026' per the master skill).
 */
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();
router.use(express.json({ limit: '10mb' }));

const DB_PATH = process.env.HUB_DB_PATH ||
  path.join(process.env.HOME || '/Users/phoenixphaseconverters', 'phoenix-hub/data/hub.db');
const API_KEY = process.env.PHOENIX_HUB_API_KEY || 'phoenix-hub-2026';

// Open the DB in WAL mode so concurrent readers (the MCP server, dashboards)
// don't block this writer.
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// Idempotent UPSERT statements — if the same call gets webhook'd twice
// (CallRail occasionally retries) we update in place rather than insert
// a duplicate.
const upsertEvent = db.prepare(`
  INSERT INTO events
    (id, source, type, timestamp, read, from_addr, to_addr,
     caller_name, subject, order_num, summary, content, raw)
  VALUES
    (@id, 'callrail', 'call', @timestamp, 0, @from_addr, @to_addr,
     @caller_name, @subject, '', @summary, @content, @raw)
  ON CONFLICT(id) DO UPDATE SET
    timestamp   = excluded.timestamp,
    from_addr   = excluded.from_addr,
    caller_name = excluded.caller_name,
    summary     = excluded.summary,
    content     = excluded.content,
    raw         = excluded.raw
`);

// Customer touch — bumps last_contact, total_calls, last_summary, and
// fills first_contact + name/city/state on the first ever call.
const touchCustomer = db.prepare(`
  INSERT INTO customers (phone, name, city, state, source,
                         total_calls, total_texts, total_orders, total_revenue,
                         last_contact, last_summary,
                         first_contact, updated_at)
  VALUES (@phone, @name, @city, @state, 'callrail',
          1, 0, 0, 0,
          @last_contact, @last_summary,
          @last_contact, @last_contact)
  ON CONFLICT(phone) DO UPDATE SET
    total_calls   = total_calls + 1,
    last_contact  = excluded.last_contact,
    last_summary  = excluded.last_summary,
    name          = CASE WHEN customers.name = '' THEN excluded.name ELSE customers.name END,
    city          = CASE WHEN customers.city = '' THEN excluded.city ELSE customers.city END,
    state         = CASE WHEN customers.state = '' THEN excluded.state ELSE customers.state END,
    updated_at    = excluded.last_contact
`);

const lookupCustomer = db.prepare(`
  SELECT name, company, total_calls, total_orders, total_revenue,
         ai_recommended_product, ai_buying_stage
  FROM customers WHERE phone = ? LIMIT 1
`);

function requireKey(req, res, next) {
  if (req.get('X-API-Key') !== API_KEY) {
    return res.status(401).json({ error: 'invalid api key' });
  }
  next();
}

/**
 * POST /api/ingest/callrail
 *
 * Body shape (sent by the n8n workflow):
 *   {
 *     callId:        "CAL019dfdf26d007945815e49daee2226f0",
 *     phone:         "+12563531413",
 *     trackingPhone: "+18889627880",
 *     callerName:    "DECATUR AL" | "Mac Reed",
 *     city:          "Decatur",
 *     state:         "AL",
 *     direction:     "inbound",
 *     duration:      220,
 *     answered:      true,
 *     voicemail:     false,
 *     startTime:     "2026-05-06T10:40:16.440-05:00",
 *     transcript:    "Caller: ...",          // optional, can be null on missed
 *     callRailSummary: "Mac Reed from Beltline Electric...",  // CallRail's own
 *     aiOneSentence: "Mac Reed asks for a 40HP quote..."      // n8n-built
 *   }
 *
 * Returns: { ok: true, eventId, customer: {...} }
 */
router.post('/api/ingest/callrail', requireKey, (req, res) => {
  const b = req.body || {};
  if (!b.callId || !b.phone) {
    return res.status(400).json({ error: 'callId and phone required' });
  }

  const ts = b.startTime
    ? Math.floor(new Date(b.startTime).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  // Pick the best caller_name: prefer human-looking names over CallRail's
  // "DECATUR AL" geo placeholder.
  const looksGeo = (s) =>
    !s || /^[A-Z][A-Z\s]+$/.test(s) || /TOLLFREE|WIRELESS|UNKNOWN/i.test(s);
  const cleanedName = looksGeo(b.callerName) ? '' : b.callerName.trim();

  const subject =
    `${b.direction === 'inbound' ? 'Inbound' : 'Outbound'} call · ` +
    `${Math.round((b.duration || 0) / 60)} min` +
    (b.voicemail ? ' · voicemail' : (!b.answered ? ' · missed' : ''));

  const summary = b.aiOneSentence || b.callRailSummary || '';

  const raw = JSON.stringify({
    callId: b.callId,
    trackingPhone: b.trackingPhone,
    direction: b.direction,
    duration: b.duration,
    answered: b.answered,
    voicemail: b.voicemail,
    startTime: b.startTime,
    callRailSummary: b.callRailSummary,
    ingestedAt: new Date().toISOString(),
  });

  const eventId = b.callId;  // CallRail call IDs are unique and stable

  const tx = db.transaction(() => {
    upsertEvent.run({
      id:          eventId,
      timestamp:   ts,
      from_addr:   b.phone,
      to_addr:     b.trackingPhone || '',
      caller_name: cleanedName,
      subject,
      summary,
      content:     b.transcript || '',
      raw,
    });

    touchCustomer.run({
      phone:        b.phone,
      name:         cleanedName,
      city:         b.city || '',
      state:        b.state || '',
      last_contact: ts,
      last_summary: summary,
    });
  });

  try {
    tx();
  } catch (err) {
    console.error('[callrail-ingest] db error', err);
    return res.status(500).json({ error: 'db write failed', detail: String(err) });
  }

  // Return the (now-updated) customer record so n8n can use it in the push
  // notification ("3rd call from Mac Reed — total revenue $7,863").
  const cust = lookupCustomer.get(b.phone) || {};

  res.json({
    ok: true,
    eventId,
    customer: cust,
    ingestedAt: new Date().toISOString(),
  });
});

/**
 * Health check — used by n8n to confirm the API is reachable before
 * the actual ingest call.
 */
router.get('/api/ingest/callrail/health', (req, res) => {
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM events').get();
    res.json({ ok: true, eventCount: row.n });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

module.exports = router;
