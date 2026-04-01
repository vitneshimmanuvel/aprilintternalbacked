require('dotenv').config();
const pool = require('./src/config/db');

async function migrate() {
  try {
    await pool.query(`ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS money_collected BOOLEAN DEFAULT false`);
    console.log('Added money_collected column to lead_notes table');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

migrate();
