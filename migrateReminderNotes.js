require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('Adding completion_status and completion_note to reminders...');
    await pool.query('ALTER TABLE reminders ADD COLUMN IF NOT EXISTS completion_status VARCHAR(50) DEFAULT \'completed\'');
    await pool.query('ALTER TABLE reminders ADD COLUMN IF NOT EXISTS completion_note TEXT');
    console.log('Migration successful.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
