require('dotenv').config();
const pool = require('./src/config/db');

async function fixDb() {
  console.log('Removing strict stage constraints from the database...');
  try {
    await pool.query('ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check');
    console.log('✅ Successfully removed the strict stage limit. Custom stages will now work!');
  } catch (err) {
    console.error('❌ Failed to update DB:', err.message);
  } finally {
    pool.end();
  }
}

fixDb();
