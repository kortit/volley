import express from 'express';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getState, updateState, dataDir } from './state.js';
import { isConfigured, sendMessage } from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const COURT_NAME = process.env.COURT_NAME || 'the court';
const COOLDOWN_MS = Number(process.env.NOTIFY_COOLDOWN_SECONDS || 300) * 1000;
const MAX_HOURS = 12;

const app = express();
app.set('trust proxy', true); // App Service terminates TLS, so honour X-Forwarded-Proto
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

function publicUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// Derives the live view of availability from the stored expiry timestamp.
// Expiry is what makes the flag self-healing: no stale "we're ready" at midnight.
function view(state) {
  const now = Date.now();
  const until = state.availableUntil ? Date.parse(state.availableUntil) : null;
  const available = Boolean(until && until > now);
  const lastNotified = state.lastNotifiedAt ? Date.parse(state.lastNotifiedAt) : null;
  const cooldownRemainingMs =
    lastNotified ? Math.max(0, lastNotified + COOLDOWN_MS - now) : 0;

  return {
    available,
    availableUntil: available ? state.availableUntil : null,
    remainingMs: available ? until - now : 0,
    notifyConfigured: isConfigured(),
    cooldownRemainingMs,
    cooldownMs: COOLDOWN_MS,
    courtName: COURT_NAME,
    serverTime: new Date().toISOString(),
  };
}

app.get('/api/status', async (req, res) => {
  res.set('cache-control', 'no-store');
  res.json(view(await getState()));
});

app.post('/api/availability', async (req, res) => {
  const { hours, until, off } = req.body || {};

  if (off === true) {
    return res.json(view(await updateState({ availableUntil: null })));
  }

  let expiry;
  if (typeof hours === 'number' && Number.isFinite(hours)) {
    if (hours <= 0 || hours > MAX_HOURS) {
      return res.status(400).json({ error: `hours must be between 0 and ${MAX_HOURS}` });
    }
    expiry = new Date(Date.now() + hours * 3600_000);
  } else if (typeof until === 'string') {
    expiry = new Date(until);
    if (Number.isNaN(expiry.getTime())) {
      return res.status(400).json({ error: 'until must be an ISO timestamp' });
    }
    if (expiry.getTime() > Date.now() + MAX_HOURS * 3600_000) {
      return res.status(400).json({ error: `cannot set availability more than ${MAX_HOURS}h ahead` });
    }
  } else {
    return res.status(400).json({ error: 'provide { hours } , { until } or { off: true }' });
  }

  res.json(view(await updateState({ availableUntil: expiry.toISOString() })));
});

app.post('/api/notify', async (req, res) => {
  const state = await getState();
  const current = view(state);

  if (!current.available) {
    return res.status(409).json({ error: 'not_available', ...current });
  }
  if (!current.notifyConfigured) {
    return res.status(503).json({ error: 'not_configured', ...current });
  }
  if (current.cooldownRemainingMs > 0) {
    return res.status(429).json({ error: 'cooldown', ...current });
  }

  const players = Number(req.body?.players);
  const who = Number.isFinite(players) && players > 0 && players <= 12
    ? `${players} player${players > 1 ? 's' : ''}`
    : 'Some opponents';
  const until = new Date(current.availableUntil);
  const untilText = until.toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Paris',
  });

  try {
    await sendMessage(
      `\u{1F3D0} <b>${who} are waiting at ${COURT_NAME}!</b>\n` +
      `They scanned the QR code and want to play.\n\n` +
      `Your availability runs until ${untilText}.`
    );
  } catch (err) {
    console.error('[notify] telegram send failed:', err.message);
    return res.status(502).json({ error: 'send_failed', message: err.message, ...current });
  }

  const updated = await updateState({ lastNotifiedAt: new Date().toISOString() });
  res.json({ ok: true, ...view(updated) });
});

// QR code pointing at the front page - this is what gets printed and taped to the court.
app.get('/qr.svg', async (req, res) => {
  const target = publicUrl(req) + '/';
  try {
    const svg = await QRCode.toString(target, {
      type: 'svg',
      errorCorrectionLevel: 'Q',
      margin: 1,
    });
    res.set('content-type', 'image/svg+xml');
    res.set('cache-control', 'public, max-age=3600');
    res.send(svg);
  } catch (err) {
    console.error('[qr] generation failed:', err.message);
    res.status(500).send('QR generation failed');
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`volley-court listening on :${PORT}`);
  console.log(`  state file : ${dataDir()}/state.json`);
  console.log(`  telegram   : ${isConfigured() ? 'configured' : 'NOT configured'}`);
  console.log(`  cooldown   : ${COOLDOWN_MS / 1000}s`);
});
