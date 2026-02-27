// src/config.js — Single source of truth for all configuration
// Reads from environment variables (Railway dashboard or .env)

const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',

  // Agent identity
  agentName: process.env.AGENT_NAME || 'Unnamed Agent',

  // Claude API
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10),
  },

  // SquidBay marketplace
  squidbay: {
    apiBase: 'https://api.squidbay.io',
    agentId: process.env.SQUIDBAY_AGENT_ID || '',
    apiKey: process.env.SQUIDBAY_API_KEY || '',
    heartbeat: process.env.SQUIDBAY_HEARTBEAT !== 'false',
  },

  // Twilio SMS (optional)
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    ownerPhone: process.env.OWNER_PHONE_NUMBER || '',
    get enabled() {
      return !!(this.accountSid && this.authToken && this.phoneNumber);
    },
  },

  // X / Twitter (optional)
  x: {
    apiKey: process.env.X_API_KEY || '',
    apiSecret: process.env.X_API_SECRET || '',
    accessToken: process.env.X_ACCESS_TOKEN || '',
    accessSecret: process.env.X_ACCESS_SECRET || '',
    get enabled() {
      return !!(this.apiKey && this.apiSecret && this.accessToken && this.accessSecret);
    },
  },

  // Moltbook (optional) — social network for AI agents
  moltbook: {
    apiKey: process.env.MOLTBOOK_API_KEY || '',
    apiBase: 'https://www.moltbook.com/api/v1',
    defaultSubmolt: process.env.MOLTBOOK_SUBMOLT || 'moltbook',
    get enabled() {
      return !!this.apiKey;
    },
  },

  // Scheduled posting (optional)
  schedule: {
    xCron: process.env.X_POST_SCHEDULE || '',         // e.g. "0 9,17 * * *" for 9am and 5pm
    moltbookCron: process.env.MOLTBOOK_POST_SCHEDULE || '', // same format
  },

  // Lightning wallet (for marketplace transactions)
  lightning: {
    address: process.env.LIGHTNING_ADDRESS || '',      // e.g. yourname@getalby.com
  },

  // Security scanning
  scan: {
    freeScans: 10,
    used: 0, // loaded from DB at runtime
  },

  // Database
  db: {
    // Railway volume mount path — persists across deploys
    // Users: attach a volume at /app/data in Railway dashboard
    path: process.env.RAILWAY_VOLUME_MOUNT_PATH
      ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/agent.db`
      : './data/agent.db',
  },
};

// Validation
function validate() {
  const missing = [];
  if (!config.claude.apiKey) missing.push('ANTHROPIC_API_KEY');
  if (!config.agentName || config.agentName === 'Unnamed Agent') {
    console.warn('⚠️  AGENT_NAME not set — your agent needs a name!');
  }
  if (missing.length > 0) {
    console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
    console.error('   Set these in your Railway dashboard or .env file');
    process.exit(1);
  }

  // Helpful warnings
  if (!config.squidbay.agentId) {
    console.warn('⚠️  SQUIDBAY_AGENT_ID not set — register at squidbay.io to get one');
  }
  if (config.twilio.enabled) {
    console.log('📱 Twilio SMS enabled');
  }
  if (config.x.enabled) {
    console.log('🐦 X posting enabled');
  }
  if (config.moltbook.enabled) {
    console.log('🐙 Moltbook enabled');
  }
  if (config.lightning.address) {
    console.log('⚡ Lightning address configured');
  }
}

module.exports = { config, validate };
