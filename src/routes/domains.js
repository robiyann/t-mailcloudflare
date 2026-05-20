const express = require('express');
const router = express.Router();
const queries = require('../db/queries');
const { requireApiKey } = require('../utils/auth');
const { getCloudflareDomains } = require('../utils/cloudflare');

/**
 * @swagger
 * /domains:
 *   get:
 *     summary: Get all active domains
 *     tags: [Domains]
 *     responses:
 *       200:
 *         description: List of active domains, sourced from Cloudflare zones API (cached 5 min) or local DB fallback
 *         content:
 *           application/json:
 *             example:
 *               domains:
 *                 - zyvenox.my.id
 *                 - mail.zyvenox.my.id
 *               source: cloudflare
 */
router.get('/', async (req, res) => {
  try {
    // 1. Try to fetch dynamic domains from Cloudflare API
    const cfDomains = await getCloudflareDomains();
    if (cfDomains && cfDomains.length > 0) {
      return res.json({ domains: cfDomains, source: 'cloudflare' });
    }

    // 2. Fallback: retrieve from SQLite database domains table
    const dbDomains = queries.getDomains.all();
    res.json({ domains: dbDomains.map(d => d.domain), source: 'local_db' });
  } catch (error) {
    console.error('[Domains API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch domains' });
  }
});

/**
 * @swagger
 * /domains:
 *   post:
 *     summary: Register a new domain
 *     tags: [Domains]
 *     security:
 *       - api_key: []
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
 *                 example: zyvenox.my.id
 *               label:
 *                 type: string
 *                 description: Optional human-readable label
 *                 example: Primary mail domain
 *           example:
 *             domain: zyvenox.my.id
 *             label: Primary mail domain
 *     responses:
 *       201:
 *         description: Domain registered or reactivated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *       400:
 *         description: Missing domain field
 *         content:
 *           application/json:
 *             example:
 *               error: Domain name is required
 */
router.post('/', requireApiKey, (req, res) => {
  const { domain, label } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain name is required' });

  try {
    queries.upsertDomain.run({ domain: domain.toLowerCase().trim(), label: label || '' });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * @swagger
 * /domains/bulk:
 *   post:
 *     summary: Register domains in bulk
 *     tags: [Domains]
 *     security:
 *       - api_key: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - domains
 *             properties:
 *               domains:
 *                 type: array
 *                 items:
 *                   type: string
 *           example:
 *             domains:
 *               - zyvenox.my.id
 *               - mail.zyvenox.my.id
 *               - inbox.example.com
 *     responses:
 *       201:
 *         description: All domains in the batch were upserted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               count: 3
 *       400:
 *         description: domains field missing or not an array
 *         content:
 *           application/json:
 *             example:
 *               error: List of domains is required
 */
router.post('/bulk', requireApiKey, (req, res) => {
  const { domains } = req.body;
  if (!domains || !Array.isArray(domains)) {
    return res.status(400).json({ error: 'List of domains is required' });
  }

  try {
    for (const d of domains) {
      if (typeof d === 'string' && d.trim().length > 0) {
        queries.upsertDomain.run({ domain: d.toLowerCase().trim(), label: '' });
      }
    }
    res.status(201).json({ success: true, count: domains.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * @swagger
 * /domains/{domain}:
 *   delete:
 *     summary: Deactivate a domain
 *     tags: [Domains]
 *     security:
 *       - api_key: []
 *     parameters:
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         example: zyvenox.my.id
 *     responses:
 *       200:
 *         description: Domain removed from the local allowlist
 *         content:
 *           application/json:
 *             example:
 *               success: true
 */
router.delete('/:domain', requireApiKey, (req, res) => {
  const { domain } = req.params;
  try {
    queries.deleteDomain.run({ domain: domain.toLowerCase().trim() });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
