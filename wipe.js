require('dotenv').config();
const pool = require('./src/config/db');

async function wipe() {
  try {
    console.log('Truncating leads data cascade...');
    await pool.query('TRUNCATE TABLE leads CASCADE');
    console.log('All leads data effectively wiped.');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

wipe();
