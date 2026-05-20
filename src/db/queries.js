const db = require('./database');

// Queries
const queries = {
  getDomains: db.prepare('SELECT domain FROM domains WHERE active = 1'),
  upsertDomain: db.prepare(`
    INSERT INTO domains (domain, label, active)
    VALUES (@domain, @label, 1)
    ON CONFLICT(domain) DO UPDATE SET active = 1, label = excluded.label
  `),
  deleteDomain: db.prepare('DELETE FROM domains WHERE domain = @domain'),
  
  insertEmail: db.prepare(`
    INSERT INTO emails (
      id, address, domain, from_addr, from_name, subject, 
      body_text, body_html, raw, received_at, expires_at
    ) VALUES (
      @id, @address, @domain, @from_addr, @from_name, @subject,
      @body_text, @body_html, @raw, @received_at, @expires_at
    )
  `),
  
  getEmailsByAddress: db.prepare(`
    SELECT id, from_addr, from_name, subject, received_at, read
    FROM emails 
    WHERE address = @address
    ORDER BY received_at DESC
  `),
  
  getEmailByIdAndAddress: db.prepare(`
    SELECT *
    FROM emails
    WHERE id = @id AND address = @address
  `),
  
  markEmailAsRead: db.prepare(`
    UPDATE emails 
    SET read = 1 
    WHERE id = @id AND address = @address
  `),
  
  deleteEmail: db.prepare(`
    DELETE FROM emails
    WHERE id = @id AND address = @address
  `),
  
  deleteAllEmailsByAddress: db.prepare(`
    DELETE FROM emails
    WHERE address = @address
  `),
  
  cleanupExpiredEmails: db.prepare(`
    DELETE FROM emails
    WHERE expires_at <= @now
  `),

  insertMailbox: db.prepare(`
    INSERT INTO mailboxes (address, created_at, expires_at)
    VALUES (@address, @created_at, @expires_at)
    ON CONFLICT(address) DO UPDATE SET expires_at = excluded.expires_at
  `),

  getMailbox: db.prepare(`
    SELECT * FROM mailboxes WHERE address = @address
  `),

  deleteMailbox: db.prepare(`
    DELETE FROM mailboxes WHERE address = @address
  `),

  updateMailboxExpiry: db.prepare(`
    UPDATE mailboxes SET expires_at = @expires_at WHERE address = @address
  `),

  updateEmailsExpiryByAddress: db.prepare(`
    UPDATE emails SET expires_at = @expires_at WHERE address = @address
  `),

  cleanupExpiredMailboxes: db.prepare(`
    DELETE FROM mailboxes WHERE expires_at <= @now
  `)
};

module.exports = queries;
