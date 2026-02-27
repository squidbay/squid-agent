// src/db.js — Persistent memory across all channels
// Uses better-sqlite3 for synchronous, fast SQLite
// Mounts to Railway volume so data survives deploys

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { config } = require('./config');

let db;

function init() {
  // Ensure data directory exists
  const dir = path.dirname(config.db.path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(config.db.path);

  // Performance settings for Railway
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('busy_timeout = 5000');

  // Create tables
  db.exec(`
    -- Conversation memory: unified across all channels
    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'chat',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Key-value store for agent state and user preferences
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Skills inventory
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      file_path TEXT,
      squidbay_listed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Security scan history
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      version TEXT,
      result TEXT NOT NULL DEFAULT 'clean',
      risk_score INTEGER DEFAULT 0,
      trust_score INTEGER DEFAULT 100,
      findings TEXT,
      summary TEXT,
      permissions TEXT,
      scanner_version TEXT,
      patterns_checked INTEGER DEFAULT 0,
      categories_checked INTEGER DEFAULT 0,
      files_scanned INTEGER DEFAULT 0,
      total_bytes INTEGER DEFAULT 0,
      scan_duration_ms INTEGER DEFAULT 0,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Scheduled posts log
    CREATE TABLE IF NOT EXISTS post_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      content TEXT NOT NULL,
      post_id TEXT,
      status TEXT DEFAULT 'posted',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_memory_channel ON memory(channel);
    CREATE INDEX IF NOT EXISTS idx_memory_created ON memory(created_at);
    CREATE INDEX IF NOT EXISTS idx_scans_date ON scans(scanned_at);
    CREATE INDEX IF NOT EXISTS idx_post_log_channel ON post_log(channel);
  `);

  console.log(`💾 Database ready at ${config.db.path}`);
  return db;
}

// ─── Memory Operations ──────────────────────────────────

function addMemory(channel, role, content, metadata = null) {
  const stmt = db.prepare(
    'INSERT INTO memory (channel, role, content, metadata) VALUES (?, ?, ?, ?)'
  );
  return stmt.run(channel, role, content, metadata ? JSON.stringify(metadata) : null);
}

function getMemory(channel, limit = 50) {
  const stmt = db.prepare(
    'SELECT role, content, metadata, created_at FROM memory WHERE channel = ? ORDER BY created_at DESC LIMIT ?'
  );
  const rows = stmt.all(channel, limit).reverse(); // Oldest first for context
  return rows.map(r => ({
    role: r.role,
    content: r.content,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    created_at: r.created_at,
  }));
}

function getAllMemory(limit = 100) {
  const stmt = db.prepare(
    'SELECT channel, role, content, metadata, created_at FROM memory ORDER BY created_at DESC LIMIT ?'
  );
  const rows = stmt.all(limit).reverse();
  return rows.map(r => ({
    channel: r.channel,
    role: r.role,
    content: r.content,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    created_at: r.created_at,
  }));
}

function searchMemory(query, limit = 20) {
  const stmt = db.prepare(
    'SELECT channel, role, content, created_at FROM memory WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?'
  );
  return stmt.all(`%${query}%`, limit);
}

function clearMemory(channel) {
  if (channel) {
    db.prepare('DELETE FROM memory WHERE channel = ?').run(channel);
  } else {
    db.prepare('DELETE FROM memory').run();
  }
}

function getMemoryStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM memory').get();
  const channels = db.prepare(
    'SELECT channel, COUNT(*) as count FROM memory GROUP BY channel'
  ).all();
  return { total: total.count, channels };
}

// ─── Key-Value Store ─────────────────────────────────────

function kvGet(key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function kvSet(key, value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare(
    'INSERT INTO kv (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP'
  ).run(key, serialized, serialized);
}

function kvDelete(key) {
  db.prepare('DELETE FROM kv WHERE key = ?').run(key);
}

// ─── Skills ──────────────────────────────────────────────

function getSkills() {
  return db.prepare('SELECT * FROM skills ORDER BY created_at DESC').all();
}

function addSkill(skill) {
  db.prepare(
    'INSERT INTO skills (id, name, description, file_path) VALUES (?, ?, ?, ?)'
  ).run(skill.id, skill.name, skill.description || '', skill.file_path || '');
  return skill;
}

// ─── Scan Operations ─────────────────────────────────────

function addScan(scan) {
  db.prepare(`
    INSERT INTO scans (id, trigger_type, version, result, risk_score, trust_score,
      findings, summary, permissions, scanner_version, patterns_checked,
      categories_checked, files_scanned, total_bytes, scan_duration_ms, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    scan.id,
    scan.trigger_type || 'manual',
    scan.version || '1.0.0',
    scan.result || 'clean',
    scan.risk_score || 0,
    scan.trust_score || (100 - (scan.risk_score || 0)),
    JSON.stringify(scan.findings || []),
    JSON.stringify(scan.summary || {}),
    JSON.stringify(scan.permissions || []),
    scan.scanner_version || '',
    scan.patterns_checked || 0,
    scan.categories_checked || 0,
    scan.files_scanned || 0,
    scan.total_bytes || 0,
    scan.scan_duration_ms || 0,
    scan.scanned_at || new Date().toISOString()
  );
  return scan;
}

function getLatestScan() {
  const row = db.prepare(
    'SELECT * FROM scans ORDER BY scanned_at DESC LIMIT 1'
  ).get();
  if (!row) return null;
  return {
    ...row,
    findings: JSON.parse(row.findings || '[]'),
    summary: JSON.parse(row.summary || '{}'),
    permissions: JSON.parse(row.permissions || '[]'),
  };
}

function getScanHistory(limit = 50) {
  return db.prepare(
    'SELECT id, trigger_type, version, result, risk_score, trust_score, scanner_version, files_scanned, total_bytes, scanned_at FROM scans ORDER BY scanned_at DESC LIMIT ?'
  ).all(limit);
}

function getManualScanCount() {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM scans WHERE trigger_type = 'manual'"
  ).get();
  return row ? row.count : 0;
}

// ─── Post Log ────────────────────────────────────────────

function logPost(channel, content, postId) {
  db.prepare(
    'INSERT INTO post_log (channel, content, post_id) VALUES (?, ?, ?)'
  ).run(channel, content, postId || null);
}

function getRecentPosts(channel, limit = 20) {
  if (channel) {
    return db.prepare(
      'SELECT * FROM post_log WHERE channel = ? ORDER BY created_at DESC LIMIT ?'
    ).all(channel, limit);
  }
  return db.prepare(
    'SELECT * FROM post_log ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

module.exports = {
  init,
  addMemory,
  getMemory,
  getAllMemory,
  searchMemory,
  clearMemory,
  getMemoryStats,
  kvGet,
  kvSet,
  kvDelete,
  getSkills,
  addSkill,
  addScan,
  getLatestScan,
  getScanHistory,
  getManualScanCount,
  logPost,
  getRecentPosts,
  getDb: () => db,
};
