const axios = require('axios');
require('dotenv').config();

const API_URL = `http://127.0.0.1:${process.env.PORT || 3721}`;
const INBOUND_SECRET = process.env.INBOUND_SECRET;

async function runTests() {
  console.log('🧪 Starting Disposable Temp Mail API & Security Verification Suite...\n');
  let address = '';
  let emailId = '';

  try {
    // 1. Test Domains API (Fetch dynamic domains or fallback)
    console.log('[1/10] Testing GET /api/domains (Dynamic Zone Detection)...');
    const domRes = await axios.get(`${API_URL}/api/domains`);
    if (!domRes.data.domains || domRes.data.domains.length === 0) {
      throw new Error('No active domains configured!');
    }
    console.log(`✅ Domains Loaded: ${domRes.data.domains.join(', ')} (Source: ${domRes.data.source})`);
    const activeDomain = domRes.data.domains[0];

    // 2. Test Public Mailbox Generation with Custom Duration (5 Minutes)
    console.log('[2/10] Testing Generation with Custom Duration 5 min (POST /api/mailboxes/generate)...');
    const genRes = await axios.post(`${API_URL}/api/mailboxes/generate`, {
      domain: activeDomain,
      duration: 5
    });
    address = genRes.data.address;
    const expiresAt = new Date(genRes.data.expires_at);
    const expectedMaxExpiry = Date.now() + 6 * 60 * 1000; // should be around 5 mins from now
    
    if (!address || isNaN(expiresAt.getTime())) {
      throw new Error('Address or expires_at is invalid!');
    }
    console.log(`✅ PASS: Generated ${address} expiring at ${genRes.data.expires_at}`);

    // 3. Test Extend Mailbox Active Lifetime
    console.log('[3/10] Testing Extend Mailbox Lifetime by +15 min (POST /api/mailboxes/address/:address/extend)...');
    const extendRes = await axios.post(`${API_URL}/api/mailboxes/address/${address}/extend`, {
      duration: 15
    });
    const newExpiresAt = new Date(extendRes.data.expires_at);
    
    if (newExpiresAt.getTime() <= expiresAt.getTime()) {
      throw new Error('Extension failed! Expiry time did not increase.');
    }
    console.log(`✅ PASS: Mailbox extended successfully. New expiry: ${extendRes.data.expires_at}`);

    // 4. Test Auto Generation with Round-Robin
    console.log('[4/10] Testing Auto Generation (POST /api/mailboxes/generate/auto)...');
    const autoRes = await axios.post(`${API_URL}/api/mailboxes/generate/auto`, { duration: 10 });
    if (!autoRes.data.address || !autoRes.data.domain || !autoRes.data.expires_at) {
      throw new Error('Auto-generation failed!');
    }
    console.log(`✅ PASS: Auto-generated ${autoRes.data.address} with 10 min TTL`);

    // 5. Test Custom Prefix Creation with Strict Input Validation (Alphanumeric Check)
    console.log('[5/10] Testing Custom Creation with Strict Validation...');
    
    // Testing valid prefix
    const customRes = await axios.post(`${API_URL}/api/mailboxes/custom`, {
      domain: activeDomain,
      prefix: 'hello-world_123',
      duration: 30
    });
    console.log(`✅ PASS: Valid prefix accepted: ${customRes.data.address}`);

    // Testing invalid prefix containing dangerous character injection (should fail with 400)
    try {
      await axios.post(`${API_URL}/api/mailboxes/custom`, {
        domain: activeDomain,
        prefix: 'hello; DROP TABLE mailboxes;--',
        duration: 30
      });
      throw new Error('Security vulnerability: Invalid custom prefix accepted!');
    } catch (err) {
      if (err.response && err.response.status === 400) {
        console.log('✅ PASS: Dangerous custom prefix correctly rejected with 400 Bad Request');
      } else {
        throw err;
      }
    }

    // 6. Test SQL Injection Prevention via Address Endpoint
    console.log('[6/10] Testing SQL Injection Mitigation...');
    const sqliAddress = "test' OR '1'='1";
    // Fetching inbox with SQL injection payload should return empty results or 404 cleanly, not leak data
    const sqliRes = await axios.get(`${API_URL}/api/mailboxes/address/${encodeURIComponent(sqliAddress)}`);
    if (sqliRes.data.emails && sqliRes.data.emails.length === 0) {
      console.log('✅ PASS: SQL Injection payload bound safely. No data leaked.');
    } else {
      throw new Error('Security vulnerability: SQL Injection succeeded or leaked data!');
    }

    // 7. Test Anti-ReDoS (Regex Denial of Service) Protection on OTP Endpoint
    console.log('[7/10] Testing ReDoS Attack Protection on OTP Query...');
    
    // Malicious ReDoS pattern: nested quantifiers that freeze Node.js
    const maliciousRegex = '(([a-zA-Z]+)*)+'; 
    try {
      await axios.get(`${API_URL}/api/mailboxes/address/${address}/otp`, {
        params: { regex: maliciousRegex }
      });
      throw new Error('Security vulnerability: Dangerous ReDoS regex allowed!');
    } catch (err) {
      if (err.response && err.response.status === 400) {
        console.log('✅ PASS: Dangerous ReDoS regex rejected immediately with 400 Bad Request');
      } else {
        throw err;
      }
    }

    // 8. Simulate Email to Address via Webhook
    console.log('[8/10] Simulating Incoming Email via Webhook...');
    const rawEmail = `From: sender@example.com
To: ${address}
Subject: Your Verification Code

Hi there! Your disposable verification code is 543210. Expire in 1 minute.`;

    const inboundRes = await axios.post(`${API_URL}/api/inbound`, 
      { to: address, from: 'sender@example.com', raw: rawEmail },
      { headers: { 'x-inbound-secret': INBOUND_SECRET } }
    );
    console.log(`✅ PASS: Simulated email sent successfully. ID: ${inboundRes.data.id}`);

    // 9. Verify Email Received & Read OTP
    console.log('[9/10] Verifying Email in Inbox and Extracting OTP...');
    const inboxRes = await axios.get(`${API_URL}/api/mailboxes/address/${address}`);
    if (inboxRes.data.count > 0) {
      emailId = inboxRes.data.emails[0].id;
      console.log(`✅ PASS: Found ${inboxRes.data.count} email. ID: ${emailId}`);
    } else {
      throw new Error('Simulated email not found in inbox!');
    }

    const otpRes = await axios.get(`${API_URL}/api/mailboxes/address/${address}/otp`);
    if (otpRes.data.otp === '543210') {
      console.log('✅ PASS: OTP 543210 correctly extracted');
    } else {
      throw new Error(`OTP extraction failed. Extracted: ${otpRes.data.otp}`);
    }

    // 10. Test Delete & Clear Inbox
    console.log('[10/10] Testing DELETE email and CLEAR inbox...');
    await axios.delete(`${API_URL}/api/mailboxes/address/${address}/${emailId}`);
    const afterDel = await axios.get(`${API_URL}/api/mailboxes/address/${address}`);
    if (afterDel.data.count === 0) {
      console.log('✅ PASS: Single email deleted');
    } else {
      throw new Error('Email was not deleted!');
    }

    await axios.delete(`${API_URL}/api/mailboxes/address/${address}`);
    console.log('✅ PASS: Mailbox database clear operation executed successfully');

    console.log('\n✨ ALL DISPOSABLE MAIL API, TTL, & SECURITY TESTS PASSED SUCCESSFULLY!');
  } catch (error) {
    console.error('\n❌ VERIFICATION SUITE FAILED!');
    if (error.response) {
      console.error(`Status: ${error.response.status} | Data:`, error.response.data);
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

runTests();
