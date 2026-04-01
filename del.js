require('dotenv').config();
const pool = require('./src/config/db');

async function run() {
  try {
    const res = await pool.query("DELETE FROM users WHERE role != 'admin'");
    console.log(`Deleted ${res.rowCount} users.`);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
