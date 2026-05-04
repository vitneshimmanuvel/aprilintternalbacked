require('dotenv').config();
const pool = require('./src/config/db');

async function migrate() {
  try {
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}'::jsonb`);
    console.log('Success: custom_data column added');
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
migrate();
