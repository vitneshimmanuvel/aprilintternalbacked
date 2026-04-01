// Migration: Add 'type' column to reminders table for visit planning
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  try {
    // Check if column exists
    const check = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'reminders' AND column_name = 'type'
    `);
    
    if (check.rows.length === 0) {
      await pool.query(`ALTER TABLE reminders ADD COLUMN type VARCHAR(50) DEFAULT 'general'`);
      console.log('✅ Added "type" column to reminders table');
    } else {
      console.log('ℹ️  "type" column already exists on reminders');
    }

    // List all columns to confirm
    const cols = await pool.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'reminders' ORDER BY ordinal_position
    `);
    console.log('Reminders columns:', cols.rows.map(c => c.column_name).join(', '));
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
