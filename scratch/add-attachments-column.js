require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    console.log('--- Database Migration: Adding attachments column to lead_notes ---');
    await pool.query(`
      ALTER TABLE lead_notes 
      ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb
    `);
    console.log('Migration successful: attachments column added to lead_notes table!');
  } catch(e) {
    console.error('Migration failed:', e.message);
  } finally {
    pool.end();
  }
})();
