const axios = require('axios');

let cachedDomains = null;
let cacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getCloudflareDomains() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token || token.trim() === '') {
    // Silent ignore if token is not set, fallback will handle it
    return null;
  }

  const now = Date.now();
  if (cachedDomains && (now - cacheTime < CACHE_DURATION)) {
    console.log('[CF API] Returning cached active domains.');
    return cachedDomains;
  }

  try {
    console.log('[CF API] Fetching active zones from Cloudflare...');
    const response = await axios.get('https://api.cloudflare.com/client/v4/zones', {
      params: { status: 'active', per_page: 50 },
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000 // 5 seconds timeout
    });

    if (response.data && response.data.success && response.data.result) {
      const domains = response.data.result.map(zone => zone.name.toLowerCase().trim());
      cachedDomains = domains;
      cacheTime = now;
      console.log(`[CF API] Loaded ${domains.length} active domains from Cloudflare:`, domains.join(', '));
      return domains;
    } else {
      console.warn('[CF API] API returned unsuccessful state:', response.data);
      return null;
    }
  } catch (error) {
    console.error('[CF API] Failed to fetch domains from Cloudflare:', error.message);
    if (cachedDomains) {
      console.log('[CF API] Returning stale cache after failure.');
      return cachedDomains; // return stale cache if CF is down
    }
    return null;
  }
}

module.exports = { getCloudflareDomains, getCachedCloudflareDomains };

function getCachedCloudflareDomains() {
  return cachedDomains;
}
