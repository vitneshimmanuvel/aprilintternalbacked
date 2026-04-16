require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 5000,
});

const indexes = [
  // Fastest lookup: reminders by user + status (cron job queries this every 15 mins)
  `CREATE INDEX IF NOT EXISTS idx_reminders_user_completed ON reminders(user_id, is_completed)`,
  // Lead history is huge — needs index on lead_id for detail page loads
  `CREATE INDEX IF NOT EXISTS idx_lead_history_lead_id ON lead_history(lead_id)`,
  // Notes lookup per lead
  `CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id ON lead_notes(lead_id)`,
  // Visits lookup per lead
  `CREATE INDEX IF NOT EXISTS idx_lead_visits_lead_id ON lead_visits(lead_id)`,
  // Reminders cron: filter by is_completed + remind_at (runs every 15 mins)
  `CREATE INDEX IF NOT EXISTS idx_reminders_cron ON reminders(is_completed, remind_at) WHERE is_completed = false`,
  // Leads by assigned user (board loads)
  `CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to)`,
  // Leads by stage (board column loads)
  `CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage)`,
];

(async () => {
  const client = await pool.connect();
  try {
    console.log('Adding performance indexes to Neon...\n');
    for (const sql of indexes) {
      const name = sql.match(/idx_\w+/)?.[0] || '?';
      try {
        await client.query(sql);
        console.log(`✅ ${name}`);
      } catch (e) {
        console.log(`⚠️  ${name}: ${e.message}`);
      }
    }
    console.log('\n✅ Done! Neon queries will now be significantly faster.');
  } finally {
    client.release();
    await pool.end();
  }
})();
