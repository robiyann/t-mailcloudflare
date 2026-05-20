const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const queries = require('../db/queries');
const { getCloudflareDomains, getCachedCloudflareDomains } = require('../utils/cloudflare');

// Combine Cloudflare cache + DB so generation accepts any zone we've seen
function getActiveDomains() {
  const set = new Set();
  for (const d of getCachedCloudflareDomains() || []) set.add(d);
  for (const row of queries.getDomains.all()) set.add(row.domain);
  return [...set];
}

// ─── Rate Limiters ───────────────────────────────────────────────────────────
// DDoS & abuse mitigation
const mailboxGenLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Max 10 mailbox generations per minute
  message: { error: 'Too many mailbox generation requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const inboxPollLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Max 30 polls per minute per IP
  message: { error: 'Too many inbox requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
// ─────────────────────────────────────────────────────────────────────────────

// Helper to validate domain (Cloudflare cache primary, DB fallback)
function isValidDomain(domain) {
  if (!domain) return false;
  return getActiveDomains().includes(domain);
}

// Helper to check for ReDoS patterns in custom Regex
function isSafeRegex(pattern) {
  if (!pattern || pattern.length > 50) return false;

  // Check for dangerous nested repetitions and combinations that cause backtracking
  const dangerousPatterns = [
    /\([^\)]+\)\*/,  // (group)*
    /\([^\)]+\)\+/,  // (group)+
    /(\*|\+|\?|\{\d+,?\d*\}){2,}/, // double/sequential quantifiers like ++, *+, +{1,2}
    /\(\[.\+\]\)\*/,
    /\\{3,}/        // long backslashes
  ];

  for (const p of dangerousPatterns) {
    if (p.test(pattern)) return false;
  }

  // Whitelist safe regex characters
  const allowed = /^[a-zA-Z0-9\s\\b\\d\\w\\s\-_+.*?()|[\]{}]+$/;
  return allowed.test(pattern);
}

// ─── Round-Robin Domain Rotator ──────────────────────────────────────────────
let _rrCounter = 0;
function getNextDomainRoundRobin() {
  const domains = getActiveDomains();
  if (!domains || domains.length === 0) throw new Error('No active domains available');
  const domain = domains[_rrCounter % domains.length];
  _rrCounter++;
  if (_rrCounter >= Number.MAX_SAFE_INTEGER) _rrCounter = 0;
  return domain;
}
// ─────────────────────────────────────────────────────────────────────────────

const { generateHumanReadableId } = require('../utils/random');

// Helper to calculate expiry ISO date based on minutes
function calculateExpiry(durationMin) {
  // Cap duration between 5 minutes and 360 minutes (6 hours)
  let duration = parseInt(durationMin, 10);
  if (isNaN(duration) || duration < 5) duration = 60; // default 1 hour
  if (duration > 360) duration = 360; // max 6 hours
  
  return new Date(Date.now() + duration * 60 * 1000).toISOString();
}

/**
 * @swagger
 * /mailboxes/generate:
 *   post:
 *     summary: Generate a random email address for a given domain
 *     tags: [Mailboxes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - domain
 *             properties:
 *               domain:
 *                 type: string
 *                 description: The active domain to use
 *                 example: zyvenox.my.id
 *               duration:
 *                 type: integer
 *                 description: Expiry duration in minutes (5, 10, 30, 60, 360). Default is 60.
 *                 example: 60
 *           example:
 *             domain: zyvenox.my.id
 *             duration: 60
 *     responses:
 *       200:
 *         description: Successfully generated random mailbox
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: string
 *                 expires_at:
 *                   type: string
 *             example:
 *               address: brave-falcon-4821@zyvenox.my.id
 *               expires_at: "2026-05-20T03:45:00.000Z"
 *       400:
 *         description: Missing or invalid domain parameter
 *         content:
 *           application/json:
 *             example:
 *               error: Invalid or missing domain
 */
router.post('/generate', mailboxGenLimiter, (req, res) => {
  const { domain, duration } = req.body;
  if (!domain || !isValidDomain(domain)) {
    return res.status(400).json({ error: 'Invalid or missing domain' });
  }

  const prefix = generateHumanReadableId();
  const address = `${prefix}@${domain}`.toLowerCase();
  const created_at = new Date().toISOString();
  const expires_at = calculateExpiry(duration);

  try {
    queries.insertMailbox.run({ address, created_at, expires_at });
    res.json({ address, expires_at });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create mailbox' });
  }
});

/**
 * @swagger
 * /mailboxes/generate/auto:
 *   post:
 *     summary: Auto-generate email using round-robin domain rotation
 *     tags: [Mailboxes]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               duration:
 *                 type: integer
 *                 description: Expiry duration in minutes (5, 10, 30, 60, 360). Default is 60.
 *                 example: 30
 *           example:
 *             duration: 30
 *     responses:
 *       200:
 *         description: Auto-generated mailbox successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: string
 *                 domain:
 *                   type: string
 *                 expires_at:
 *                   type: string
 *             example:
 *               address: silent-tiger-9203@zyvenox.my.id
 *               domain: zyvenox.my.id
 *               expires_at: "2026-05-20T02:15:00.000Z"
 *       500:
 *         description: No active domains or internal error
 *         content:
 *           application/json:
 *             example:
 *               error: No active domains available
 */
router.post('/generate/auto', mailboxGenLimiter, (req, res) => {
  const { duration } = req.body;
  try {
    const domain = getNextDomainRoundRobin();
    const prefix = generateHumanReadableId();
    const address = `${prefix}@${domain}`.toLowerCase();
    const created_at = new Date().toISOString();
    const expires_at = calculateExpiry(duration);

    queries.insertMailbox.run({ address, created_at, expires_at });
    res.json({ address, domain, expires_at });
  } catch (err) {
    console.error('[RR] Failed to auto-generate mailbox:', err);
    res.status(500).json({ error: err.message || 'Failed to auto-generate mailbox' });
  }
});

/**
 * @swagger
 * /mailboxes/custom:
 *   post:
 *     summary: Register a custom prefix email address
 *     tags: [Mailboxes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - domain
 *               - prefix
 *             properties:
 *               domain:
 *                 type: string
 *                 description: Active domain to use
 *                 example: zyvenox.my.id
 *               prefix:
 *                 type: string
 *                 description: Custom prefix (letters, numbers, dot, dash, underscore only; max 30 characters)
 *                 example: contact
 *               duration:
 *                 type: integer
 *                 description: Expiry duration in minutes (5, 10, 30, 60, 360). Default is 60.
 *                 example: 360
 *           example:
 *             domain: zyvenox.my.id
 *             prefix: contact
 *             duration: 360
 *     responses:
 *       200:
 *         description: Custom mailbox created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: string
 *                 expires_at:
 *                   type: string
 *             example:
 *               address: contact@zyvenox.my.id
 *               expires_at: "2026-05-20T08:45:00.000Z"
 *       400:
 *         description: Invalid domain format, invalid prefix format, or bad payload
 *         content:
 *           application/json:
 *             example:
 *               error: Invalid username prefix format (letters, numbers, dot, dash, underscore only; max 30 chars)
 */
router.post('/custom', mailboxGenLimiter, (req, res) => {
  const { domain, prefix, duration } = req.body;
  if (!domain || !isValidDomain(domain)) {
    return res.status(400).json({ error: 'Invalid or missing domain' });
  }
  if (!prefix || typeof prefix !== 'string' || prefix.length > 30 || !/^[a-zA-Z0-9.\-_]+$/.test(prefix)) {
    return res.status(400).json({ error: 'Invalid username prefix format (letters, numbers, dot, dash, underscore only; max 30 chars)' });
  }

  const address = `${prefix}@${domain}`.toLowerCase();
  const created_at = new Date().toISOString();
  const expires_at = calculateExpiry(duration);

  try {
    queries.insertMailbox.run({ address, created_at, expires_at });
    res.json({ address, expires_at });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create custom mailbox' });
  }
});

// ─── Direct Address Based Endpoints ──────────────────────────────────────────

/**
 * @swagger
 * /mailboxes/address/{address}:
 *   get:
 *     summary: Get emails and expiration for an email address
 *     tags: [Mailboxes]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Full email address
 *         example: contact@zyvenox.my.id
 *     responses:
 *       200:
 *         description: Inbox snapshot
 *         content:
 *           application/json:
 *             example:
 *               address: contact@zyvenox.my.id
 *               count: 1
 *               emails:
 *                 - id: 42
 *                   from_name: GitHub
 *                   from_addr: noreply@github.com
 *                   subject: "[GitHub] Sign in to your account"
 *                   received_at: "2026-05-20T01:30:14.000Z"
 *                   read: 0
 *               expires_at: "2026-05-21T01:30:14.000Z"
 *       304:
 *         description: Inbox unchanged since last poll (returned when If-None-Match matches the current ETag)
 *       404:
 *         description: Mailbox expired and was cleaned up
 *         content:
 *           application/json:
 *             example:
 *               error: Mailbox has expired
 */
router.get('/address/:address', inboxPollLimiter, (req, res) => {
  const address = req.params.address.toLowerCase().trim();
  try {
    const mailbox = queries.getMailbox.get({ address });

    // Fallback: If address was generated outside this API or directly, auto-register it with a default 24h expiry
    let expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (mailbox) {
      expires_at = mailbox.expires_at;
      // If mailbox is already expired, return 404
      if (new Date(expires_at) <= new Date()) {
        queries.deleteMailbox.run({ address });
        queries.deleteAllEmailsByAddress.run({ address });
        return res.status(404).json({ error: 'Mailbox has expired' });
      }
    } else {
      queries.insertMailbox.run({
        address,
        created_at: new Date().toISOString(),
        expires_at
      });
    }

    const emails = queries.getEmailsByAddress.all({ address });

    // Cheap ETag: hash address + count + latest received_at + expires_at.
    // Stable while inbox is unchanged, so repeated polls return 304 with no body work.
    const etagSeed = `${address}|${emails.length}|${emails[0]?.received_at || ''}|${expires_at}`;
    const etag = 'W/"' + crypto.createHash('sha1').update(etagSeed).digest('base64').slice(0, 22) + '"';
    res.set('ETag', etag);
    res.set('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.json({ address, count: emails.length, emails, expires_at });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

/**
 * @swagger
 * /mailboxes/address/{address}/extend:
 *   post:
 *     summary: Extend active lifetime of mailbox
 *     tags: [Mailboxes]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: The email address to extend
 *         example: randomuser@zyvenox.my.id
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               duration:
 *                 type: integer
 *                 description: Duration in minutes to extend by (default is 15, max capped at total 6 hours from now)
 *                 example: 15
 *           example:
 *             duration: 15
 *     responses:
 *       200:
 *         description: Lifetime extended successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: string
 *                 expires_at:
 *                   type: string
 *             example:
 *               address: contact@zyvenox.my.id
 *               expires_at: "2026-05-20T02:03:00.000Z"
 *       404:
 *         description: Mailbox not found
 *         content:
 *           application/json:
 *             example:
 *               error: Mailbox not found
 */
router.post('/address/:address/extend', mailboxGenLimiter, (req, res) => {
  const address = req.params.address.toLowerCase().trim();
  let { duration } = req.body;
  if (!duration || isNaN(duration)) duration = 15; // default extend 15 minutes

  try {
    const mailbox = queries.getMailbox.get({ address });
    if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });

    const currentExpiryMs = new Date(mailbox.expires_at).getTime();
    const newExpiryMs = Math.max(Date.now(), currentExpiryMs) + duration * 60 * 1000;
    
    // Enforce max 6 hours (360 minutes) cap from NOW to prevent infinite TTL abuse
    const maxExpiryMs = Date.now() + 360 * 60 * 1000;
    const finalExpiryMs = Math.min(newExpiryMs, maxExpiryMs);
    const expires_at = new Date(finalExpiryMs).toISOString();

    queries.updateMailboxExpiry.run({ expires_at, address });
    queries.updateEmailsExpiryByAddress.run({ expires_at, address });

    res.json({ address, expires_at });
  } catch (error) {
    console.error('[Extend API] Error:', error);
    res.status(500).json({ error: 'Failed to extend mailbox lifetime' });
  }
});

/**
 * @swagger
 * /mailboxes/address/{address}/otp:
 *   get:
 *     summary: Extract OTP/code from latest email
 *     tags: [Mailboxes]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Full email address
 *         example: contact@zyvenox.my.id
 *       - in: query
 *         name: service
 *         required: false
 *         schema:
 *           type: string
 *         description: Preset service pattern (gopay, openai)
 *         example: openai
 *       - in: query
 *         name: regex
 *         required: false
 *         schema:
 *           type: string
 *         description: Custom regex (sandboxed against ReDoS, max 50 chars)
 *         example: "\\b(\\d{6})\\b"
 *     responses:
 *       200:
 *         description: OTP extracted
 *         content:
 *           application/json:
 *             example:
 *               otp: "482913"
 *               from: GitHub
 *               date: "2026-05-20T01:30:14.000Z"
 *       400:
 *         description: Custom regex rejected for ReDoS safety
 *         content:
 *           application/json:
 *             example:
 *               error: Invalid or dangerous custom regex pattern. Please use simpler alphanumeric patterns.
 *       404:
 *         description: No emails or no OTP match
 *         content:
 *           application/json:
 *             example:
 *               error: OTP not found
 */
router.get('/address/:address/otp', inboxPollLimiter, (req, res) => {
  const address = req.params.address.toLowerCase().trim();
  const { service, regex } = req.query;

  // Strict anti-ReDoS validation if custom regex is supplied
  if (regex && !isSafeRegex(regex)) {
    return res.status(400).json({ error: 'Invalid or dangerous custom regex pattern. Please use simpler alphanumeric patterns.' });
  }

  try {
    const emails = queries.getEmailsByAddress.all({ address });
    if (!emails || emails.length === 0) {
      return res.status(404).json({ error: 'No emails found' });
    }

    const latestMeta = emails[0];
    const email = queries.getEmailByIdAndAddress.get({ id: latestMeta.id, address });
    
    let content = '';
    if (email.body_text && email.body_text.trim().length > 0) {
      content = email.body_text;
    } else if (email.body_html) {
      content = email.body_html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    }
    content = content.toString();

    let pattern = /\b\d{4,6}\b/;
    if (regex) pattern = new RegExp(regex);
    else if (service) {
      const s = service.toLowerCase();
      if (s === 'gopay') pattern = /code is (\d{4})/;
      else if (s === 'openai') pattern = /\b(\d{6})\b/;
    }

    const match = content.match(pattern);
    if (match) {
      const otp = match[1] ? match[1] : match[0];
      return res.json({ otp, from: email.from_name || email.from_addr, date: email.received_at });
    }
    return res.status(404).json({ error: 'OTP not found' });
  } catch (error) {
    console.error('[OTP] Error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * @swagger
 * /mailboxes/address/{address}/{id}:
 *   get:
 *     summary: Get a specific email
 *     tags: [Mailboxes]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         example: contact@zyvenox.my.id
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Email ID returned by the inbox snapshot
 *         example: 42
 *     responses:
 *       200:
 *         description: Full email body
 *         content:
 *           application/json:
 *             example:
 *               id: 42
 *               from_name: GitHub
 *               from_addr: noreply@github.com
 *               subject: "[GitHub] Sign in to your account"
 *               received_at: "2026-05-20T01:30:14.000Z"
 *               body_text: "Your verification code is 482913"
 *               body_html: "<p>Your verification code is <b>482913</b></p>"
 *               read: 1
 *       404:
 *         description: Email not found
 *         content:
 *           application/json:
 *             example:
 *               error: Email not found
 */
router.get('/address/:address/:id', inboxPollLimiter, (req, res) => {
  const address = req.params.address.toLowerCase().trim();
  const { id } = req.params;
  try {
    const email = queries.getEmailByIdAndAddress.get({ address, id });
    if (!email) return res.status(404).json({ error: 'Email not found' });
    
    if (!email.read) {
      queries.markEmailAsRead.run({ address, id });
      email.read = 1;
    }
    res.json(email);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * @swagger
 * /mailboxes/address/{address}/{id}:
 *   delete:
 *     summary: Delete a specific email
 *     tags: [Mailboxes]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         example: contact@zyvenox.my.id
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 42
 *     responses:
 *       200:
 *         description: Email deleted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *       404:
 *         description: Email not found
 *         content:
 *           application/json:
 *             example:
 *               error: Not found
 */
router.delete('/address/:address/:id', mailboxGenLimiter, (req, res) => {
  const address = req.params.address.toLowerCase().trim();
  const { id } = req.params;
  try {
    const result = queries.deleteEmail.run({ address, id });
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * @swagger
 * /mailboxes/address/{address}:
 *   delete:
 *     summary: Clear inbox
 *     tags: [Mailboxes]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         example: contact@zyvenox.my.id
 *     responses:
 *       200:
 *         description: All emails for this address have been deleted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               deleted: 4
 */
router.delete('/address/:address', mailboxGenLimiter, (req, res) => {
  const address = req.params.address.toLowerCase().trim();
  try {
    const result = queries.deleteAllEmailsByAddress.run({ address });
    res.json({ success: true, deleted: result.changes });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
