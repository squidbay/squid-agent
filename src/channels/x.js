// src/channels/x.js — X (Twitter) posting channel
// Lets your agent post to X on your behalf
// Free developer account: developer.x.com

const crypto = require('crypto');
const { config } = require('../config');

// OAuth 1.0a signing for X API v2
function oauthSign(method, url, params = {}) {
  const oauth = {
    oauth_consumer_key: config.x.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: config.x.accessToken,
    oauth_version: '1.0',
  };

  const allParams = { ...oauth, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(config.x.apiSecret)}&${encodeURIComponent(config.x.accessSecret)}`;

  oauth.oauth_signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  const authHeader = 'OAuth ' + Object.keys(oauth)
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauth[k])}"`)
    .join(', ');

  return authHeader;
}

// Post a tweet
async function post(text) {
  if (!config.x.enabled) {
    console.warn('🐦 X posting not configured — set X_API_KEY etc.');
    return null;
  }

  // X character limit
  if (text.length > 280) {
    text = text.substring(0, 277) + '...';
  }

  const url = 'https://api.x.com/2/tweets';
  const body = JSON.stringify({ text });
  const authHeader = oauthSign('POST', url);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`🐦 Posted to X: ${text.substring(0, 50)}...`);
      return { id: data.data?.id, text };
    } else {
      const error = await response.text();
      console.error(`🐦 X API error (${response.status}):`, error);
      return null;
    }
  } catch (err) {
    console.error('🐦 X post failed:', err.message);
    return null;
  }
}

// Check if X is configured
function isEnabled() {
  return config.x.enabled;
}

module.exports = { post, isEnabled };
