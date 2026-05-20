require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const swaggerSpecs = require('./swagger');
const queries = require('./db/queries');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3721;
const API_KEY = process.env.API_KEY;

// ─── Security & CORS ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors());

// ─── Body parser ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

const { requireApiKey } = require('./utils/auth');

// ─── API Docs ─────────────────────────────────────────────────────────────────
// Custom docs page at /docs (HTML); raw OpenAPI JSON at /docs/swagger.json
app.get('/docs/swagger.json', (req, res) => res.json(swaggerSpecs));
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'docs.html'));
});

// ─── API Routes ───────────────────────────────────────────────────────────────
// /api/inbound: protected by INBOUND_SECRET (only Cloudflare Worker can write)
app.use('/api/inbound', require('./routes/inbound'));
// /api/mailboxes & /api/domains: public - security is the randomness of the address
app.use('/api/domains', require('./routes/domains'));
app.use('/api/mailboxes', require('./routes/mailbox'));
// ─── Static Web UI ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// Security Headers to prevent Phishing false positives
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Prevent being embedded in other sites
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Note: Content-Security-Policy is intentionally omitted because it cascades to
    // the iframe srcdoc, breaking arbitrary email rendering (which requires external
    // images, inline styles, and fonts from unpredictable domains).
    // Security is handled by the iframe 'sandbox' attribute blocking scripts.
    next();
});
// ─── Auto-cleanup every 10 seconds ────────────────────────────────────────────
setInterval(() => {
  try {
    const now = new Date().toISOString();
    const emailsRes = queries.cleanupExpiredEmails.run({ now });
    const mailboxesRes = queries.cleanupExpiredMailboxes.run({ now });
    
    if (emailsRes.changes > 0) {
      console.log(`[CLEANUP] Automatically deleted ${emailsRes.changes} expired emails at ${now}`);
    }
    if (mailboxesRes.changes > 0) {
      console.log(`[CLEANUP] Automatically deleted ${mailboxesRes.changes} expired mailboxes at ${now}`);
    }
  } catch (err) {
    console.error('[CLEANUP] Failed to automatically clean up expired data:', err);
  }
}, 10000);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 CF Mail Server running on http://127.0.0.1:${PORT}`);
  console.log(`📚 API Docs available at http://127.0.0.1:${PORT}/docs`);
  if (!API_KEY) {
    console.warn('⚠️  WARNING: API_KEY is not set! Add API_KEY=your_secret to .env to protect your API.');
  }
});

