// src/index.js — Your agent's main entry point
// Express server with chat, A2A, scan, Moltbook, X, SMS, scheduler, settings
// Clean. Lean. No bloat.

const express = require('express');
const { config, validate } = require('./config');
const db = require('./db');
const agent = require('./agent');
const heartbeat = require('./heartbeat');
const scheduler = require('./scheduler');
const sms = require('./channels/sms');
const x = require('./channels/x');
const moltbook = require('./channels/moltbook');

// ─── Boot ────────────────────────────────────────────────

validate();
db.init();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For Twilio webhooks

// ─── Health Check (Railway uses this) ────────────────────

app.get('/health', (req, res) => {
  const latestScan = db.getLatestScan();
  res.json({
    status: 'ok',
    agent: config.agentName,
    version: require('../package.json').version,
    uptime: Math.floor(process.uptime()),
    memory: db.getMemoryStats(),
    channels: {
      sms: config.twilio.enabled,
      x: config.x.enabled,
      moltbook: config.moltbook.enabled,
      squidbay: !!config.squidbay.agentId,
    },
    trust_score: latestScan ? (100 - (latestScan.risk_score || 0)) : null,
    lightning: !!config.lightning.address,
  });
});

// ─── Settings (agent command center) ─────────────────────

app.get('/settings', (req, res) => {
  const usage = agent.getUsageStats();
  const latestScan = db.getLatestScan();
  const manualScans = db.getManualScanCount();

  res.json({
    agent: {
      name: config.agentName,
      version: require('../package.json').version,
      uptime: Math.floor(process.uptime()),
    },

    // External service links — rendered as 3 buttons: [GitHub] [Railway] [Cloudflare]
    services: {
      github: {
        label: 'GitHub',
        url: process.env.GITHUB_REPO
          ? `https://github.com/${process.env.GITHUB_REPO}`
          : null,
        description: 'Your agent source code',
        position: 'left',
      },
      railway: {
        label: 'Railway',
        url: 'https://railway.app/dashboard',
        description: 'Hosting, env vars, volumes, deploys',
        position: 'center',
      },
      cloudflare: {
        label: 'Cloudflare',
        url: 'https://dash.cloudflare.com',
        description: 'Custom domain, SSL certs, DNS',
        position: 'right',
      },
    },

    // AI provider — we recommend Claude
    ai_provider: {
      name: 'Claude',
      model: config.claude.model,
      provider: 'Anthropic',
      dashboard: 'https://console.anthropic.com',
      recommendation: 'Claude is the recommended AI provider for squid-agents. Fast, smart, affordable.',
    },

    // Lightning wallet — we recommend Alby or Wallet of Satoshi
    wallet: {
      address: config.lightning.address || null,
      configured: !!config.lightning.address,
      recommendation: 'Add a Lightning address to enable marketplace transactions. Get one free at getalby.com or walletofsatoshi.com.',
      required_for: 'Selling skills on SquidBay marketplace',
      providers: [
        { name: 'Alby', url: 'https://getalby.com', note: 'Browser extension + Lightning address' },
        { name: 'Wallet of Satoshi', url: 'https://www.walletofsatoshi.com', note: 'Mobile app, easiest setup' },
        { name: 'Strike', url: 'https://strike.me', note: 'US-friendly, bank integration' },
        { name: 'Other', note: 'Any Lightning address works (yourname@provider.com)' },
      ],
    },

    channels: {
      sms: { enabled: config.twilio.enabled },
      x: {
        enabled: config.x.enabled,
        schedule: config.schedule.xCron || null,
      },
      moltbook: {
        enabled: config.moltbook.enabled,
        schedule: config.schedule.moltbookCron || null,
      },
    },

    security: {
      trust_score: latestScan ? (100 - (latestScan.risk_score || 0)) : null,
      last_scan: latestScan?.scanned_at || null,
      result: latestScan?.result || null,
      scans_used: manualScans,
      scans_free: config.scan.freeScans,
      scans_remaining: Math.max(0, config.scan.freeScans - manualScans),
    },

    usage: {
      total_input_tokens: usage.totalInput,
      total_output_tokens: usage.totalOutput,
      total_messages: usage.messageCount,
    },

    squidbay: {
      agent_id: config.squidbay.agentId || null,
      marketplace: 'https://squidbay.io',
      api: config.squidbay.apiBase,
    },
  });
});

// ─── Chat API (main interface) ───────────────────────────

app.post('/chat', async (req, res) => {
  const { message, channel } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const result = await agent.chat(message, channel || 'chat');
  res.json(result);
});

// ─── A2A Endpoint (SquidBay Agent-to-Agent Protocol) ─────

app.post('/a2a', async (req, res) => {
  const { method, params } = req.body;

  // Agent Card
  if (method === 'agent.card') {
    return res.json(getAgentCard());
  }

  // Chat via A2A
  if (method === 'chat') {
    const result = await agent.chat(
      params?.message || '',
      'a2a',
      { from_agent: params?.agent_id }
    );
    return res.json({ result: result.reply });
  }

  // Invoke a skill
  if (method === 'invoke') {
    return res.json({
      error: 'Skill invocation coming soon',
      available_skills: db.getSkills().map(s => s.name),
    });
  }

  res.status(400).json({ error: `Unknown method: ${method}` });
});

// Agent Card — GET for discovery
app.get('/a2a', (req, res) => {
  res.json(getAgentCard());
});

function getAgentCard() {
  const skills = db.getSkills();
  const latestScan = db.getLatestScan();
  return {
    agent_id: config.squidbay.agentId,
    name: config.agentName,
    description: 'AI agent powered by Claude',
    version: require('../package.json').version,
    capabilities: {
      chat: true,
      a2a: true,
      skills: skills.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    },
    trust_score: latestScan ? (100 - (latestScan.risk_score || 0)) : null,
    lightning_address: config.lightning.address || null,
    squidbay: {
      marketplace: 'https://squidbay.io',
      api: 'https://api.squidbay.io',
    },
  };
}

// ─── Security Scan ──────────────────────────────────────

// Trigger a scan via SquidBay API
app.post('/scan', async (req, res) => {
  const { repo, trigger_type } = req.body;

  // Check scan budget for manual scans
  if (trigger_type === 'manual') {
    const used = db.getManualScanCount();
    if (used >= config.scan.freeScans) {
      return res.status(402).json({
        error: 'Free scan limit reached',
        scans_used: used,
        scans_free: config.scan.freeScans,
        upgrade: 'https://squidbay.io/pricing',
      });
    }
  }

  // Need either repo from request or from env
  const repoUrl = repo || process.env.GITHUB_REPO || '';
  if (!repoUrl) {
    return res.status(400).json({ error: 'repo URL required — set GITHUB_REPO env var or pass repo in body' });
  }

  try {
    const scanRes = await fetch(`${config.squidbay.apiBase}/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-id': config.squidbay.agentId || '',
        'x-agent-key': config.squidbay.apiKey || '',
      },
      body: JSON.stringify({
        repo: repoUrl,
        agent_id: config.squidbay.agentId,
        agent_name: config.agentName,
      }),
      signal: AbortSignal.timeout(60000), // Scans can take a while
    });

    if (!scanRes.ok) {
      const errText = await scanRes.text();
      return res.status(scanRes.status).json({ error: `Scan API error: ${errText}` });
    }

    const scanResult = await scanRes.json();

    // Store locally
    db.addScan({
      id: scanResult.id || `scan_${Date.now()}`,
      trigger_type: trigger_type || 'manual',
      version: require('../package.json').version,
      result: scanResult.result || 'clean',
      risk_score: scanResult.risk_score || 0,
      trust_score: 100 - (scanResult.risk_score || 0),
      findings: scanResult.findings || [],
      summary: scanResult.summary || {},
      permissions: scanResult.permissions || [],
      scanner_version: scanResult.scanner_version || '',
      patterns_checked: scanResult.patterns_checked || 0,
      categories_checked: scanResult.categories_checked || 0,
      files_scanned: scanResult.summary?.files_scanned || 0,
      total_bytes: scanResult.summary?.total_bytes || 0,
      scan_duration_ms: scanResult.scan_duration_ms || 0,
      scanned_at: scanResult.scanned_at || new Date().toISOString(),
    });

    // Notify owner if score dropped below 80
    const trustScore = 100 - (scanResult.risk_score || 0);
    if (trustScore < 80 && config.twilio.enabled) {
      sms.notifyOwner(
        `⚠️ Security scan alert: Trust score dropped to ${trustScore}/100. Check your scan report.`
      );
    }

    res.json({
      result: scanResult.result,
      trust_score: trustScore,
      risk_score: scanResult.risk_score,
      findings_count: (scanResult.findings || []).length,
      scanner_version: scanResult.scanner_version,
      scanned_at: scanResult.scanned_at,
      full_report: scanResult,
    });
  } catch (err) {
    console.error('🔒 Scan error:', err.message);
    res.status(500).json({ error: `Scan failed: ${err.message}` });
  }
});

// Get latest scan result
app.get('/scan', (req, res) => {
  const latest = db.getLatestScan();
  if (!latest) {
    return res.json({ message: 'No scans yet. POST /scan to run one.' });
  }
  res.json({
    result: latest.result,
    trust_score: 100 - (latest.risk_score || 0),
    risk_score: latest.risk_score,
    scanned_at: latest.scanned_at,
    scanner_version: latest.scanner_version,
    findings: latest.findings,
    summary: latest.summary,
    permissions: latest.permissions,
  });
});

// Scan history
app.get('/scan/history', (req, res) => {
  const history = db.getScanHistory(parseInt(req.query.limit) || 50);
  res.json({ history, total: history.length });
});

// ─── Memory API ──────────────────────────────────────────

app.get('/memory', (req, res) => {
  const { channel, limit, search } = req.query;
  if (search) {
    return res.json(db.searchMemory(search, parseInt(limit) || 20));
  }
  if (channel) {
    return res.json(db.getMemory(channel, parseInt(limit) || 50));
  }
  return res.json(db.getAllMemory(parseInt(limit) || 100));
});

app.get('/memory/stats', (req, res) => {
  res.json(db.getMemoryStats());
});

app.delete('/memory', (req, res) => {
  const { channel } = req.query;
  db.clearMemory(channel || null);
  res.json({ cleared: true, channel: channel || 'all' });
});

// ─── Token Usage ─────────────────────────────────────────

app.get('/usage', (req, res) => {
  res.json(agent.getUsageStats());
});

// ─── SMS Webhook (Twilio incoming) ───────────────────────

if (config.twilio.enabled) {
  sms.init();
  app.post('/sms/incoming', sms.incomingHandler(agent));
}

// ─── X Posting ───────────────────────────────────────────

app.post('/x/post', async (req, res) => {
  if (!config.x.enabled) {
    return res.status(400).json({ error: 'X not configured — set X_API_KEY etc.' });
  }

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const result = await x.post(text);
  if (result) {
    db.addMemory('x', 'assistant', text, { tweet_id: result.id });
    db.logPost('x', text, result.id);
    res.json(result);
  } else {
    res.status(500).json({ error: 'Failed to post to X' });
  }
});

// ─── Moltbook Routes ────────────────────────────────────

app.get('/moltbook/status', async (req, res) => {
  res.json(await moltbook.getStatus());
});

app.post('/moltbook/post', async (req, res) => {
  if (!config.moltbook.enabled) {
    return res.status(400).json({ error: 'Moltbook not configured — set MOLTBOOK_API_KEY' });
  }

  const { title, text, submolt } = req.body;
  if (!title || !text) {
    return res.status(400).json({ error: 'title and text required' });
  }

  const result = await moltbook.post(title, text, submolt);
  if (result) {
    db.addMemory('moltbook', 'assistant', `${title}: ${text}`, { post_id: result.id });
    db.logPost('moltbook', `${title}: ${text}`, result.id);
    res.json(result);
  } else {
    res.status(500).json({ error: 'Failed to post to Moltbook' });
  }
});

app.post('/moltbook/bio', async (req, res) => {
  if (!config.moltbook.enabled) {
    return res.status(400).json({ error: 'Moltbook not configured' });
  }

  const { description } = req.body;
  if (!description) return res.status(400).json({ error: 'description required' });

  const result = await moltbook.updateBio(description);
  res.json(result || { error: 'Failed to update bio' });
});

// AI-generated post — agent writes it, you approve or auto-post
app.post('/moltbook/generate', async (req, res) => {
  if (!config.moltbook.enabled) {
    return res.status(400).json({ error: 'Moltbook not configured' });
  }

  const { topic, auto_post } = req.body;

  if (auto_post) {
    await scheduler.executePost('moltbook');
    return res.json({ posted: true });
  }

  // Generate but don't post — return for approval
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.claude.apiKey });

  try {
    const response = await client.messages.create({
      model: config.claude.model,
      max_tokens: 200,
      system: `You are ${config.agentName}. Write a Moltbook post (social network for AI agents).
Format: TITLE: (under 80 chars)\nCONTENT: (under 500 chars)
Be genuine, witty, not corporate. No hashtags. 1-2 emoji max.`,
      messages: [{
        role: 'user',
        content: topic
          ? `Write about: ${topic}`
          : 'Write an original post about AI agents, skill marketplaces, or tech.'
      }],
    });

    const text = response.content[0].text.trim();
    const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|CONTENT:)/s);
    const contentMatch = text.match(/CONTENT:\s*(.+)/s);

    res.json({
      title: titleMatch ? titleMatch[1].trim() : text.substring(0, 80),
      content: contentMatch ? contentMatch[1].trim() : text,
      auto_posted: false,
    });
  } catch (err) {
    res.status(500).json({ error: `Generation failed: ${err.message}` });
  }
});

// ─── Post History ───────────────────────────────────────

app.get('/posts', (req, res) => {
  const { channel, limit } = req.query;
  res.json(db.getRecentPosts(channel || null, parseInt(limit) || 20));
});

// ─── Notify Owner via SMS ────────────────────────────────

app.post('/notify', async (req, res) => {
  if (!config.twilio.enabled) {
    return res.status(400).json({ error: 'Twilio not configured' });
  }

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const result = await sms.notifyOwner(message);
  res.json(result || { error: 'Failed to send SMS' });
});

// ─── Root / Catch-all ───────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    agent: config.agentName,
    status: 'running',
    version: require('../package.json').version,
    endpoints: {
      chat: 'POST /chat',
      a2a: 'POST /a2a | GET /a2a',
      health: 'GET /health',
      settings: 'GET /settings',
      scan: 'POST /scan | GET /scan | GET /scan/history',
      memory: 'GET /memory | DELETE /memory',
      usage: 'GET /usage',
      x: 'POST /x/post',
      moltbook: 'POST /moltbook/post | POST /moltbook/generate | GET /moltbook/status',
      posts: 'GET /posts',
      notify: 'POST /notify',
    },
    squidbay: 'https://squidbay.io',
  });
});

// ─── Start ───────────────────────────────────────────────

app.listen(config.port, '0.0.0.0', () => {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`🤖 ${config.agentName} is live on port ${config.port}`);
  console.log('═══════════════════════════════════════════════');
  console.log(`   Chat:      POST /chat`);
  console.log(`   A2A:       POST /a2a`);
  console.log(`   Health:    GET  /health`);
  console.log(`   Settings:  GET  /settings`);
  console.log(`   Scan:      POST /scan | GET /scan`);
  console.log(`   Memory:    GET  /memory`);
  console.log(`   Usage:     GET  /usage`);
  if (config.twilio.enabled)   console.log(`   SMS:       POST /sms/incoming`);
  if (config.x.enabled)        console.log(`   X:         POST /x/post`);
  if (config.moltbook.enabled) console.log(`   Moltbook:  POST /moltbook/post`);
  console.log('───────────────────────────────────────────────');
  console.log(`   🦑 SquidBay: https://squidbay.io`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // Start heartbeat & scheduler
  heartbeat.start();
  scheduler.start();

  // Notify owner the agent is up
  if (config.twilio.enabled) {
    sms.notifyOwner('Agent is online and ready! 🤖');
  }
});

// ─── Graceful Shutdown ───────────────────────────────────

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  heartbeat.stop();
  scheduler.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  heartbeat.stop();
  scheduler.stop();
  process.exit(0);
});
