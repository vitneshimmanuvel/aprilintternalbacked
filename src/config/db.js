const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // ── Neon compute-saving settings ──────────────────────────────────
  max: 2,                    // default is 10 — 10 open connections = constant compute bill
  min: 0,                    // don't keep any connections open when idle
  idleTimeoutMillis: 10000,  // close idle connections after 10 seconds
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: true,     // let Node exit cleanly when idle
});

pool.on('error', (err) => console.error('❌ DB pool error:', err));

module.exports = pool;
