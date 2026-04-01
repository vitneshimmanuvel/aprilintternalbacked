const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log('Adding fcm_token to users...');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS fcm_token VARCHAR(255);
    `);

    console.log('Adding is_notified to reminders...');
    await client.query(`
      ALTER TABLE reminders 
      ADD COLUMN IF NOT EXISTS is_notified BOOLEAN DEFAULT false;
    `);

    await client.query('COMMIT');
    console.log('Migration successful.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
