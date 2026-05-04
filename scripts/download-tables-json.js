const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const tables = [
  'users',
  'leads',
  'lead_history',
  'lead_notes',
  'note_edits',
  'reminders'
];

async function backupDatabase() {
  console.log('🔄 Starting Database Backup from Neon...');
  let backupData = {};

  try {
    for (let table of tables) {
      console.log(`Downloading table: ${table}...`);
      const { rows } = await pool.query(`SELECT * FROM ${table}`);
      backupData[table] = rows;
      console.log(`✅ ${table}: ${rows.length} rows`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folderPath = path.join(__dirname, '../backup');
    
    if (!fs.existsSync(folderPath)){
        fs.mkdirSync(folderPath);
    }

    const filename = path.join(folderPath, `neon_db_backup_${timestamp}.json`);
    
    fs.writeFileSync(filename, JSON.stringify(backupData, null, 2));
    console.log(`\n🎉 SUCCESS! Database fully backed up to: backend/backup/neon_db_backup_${timestamp}.json`);
  } catch (error) {
    console.error('❌ Error during backup:', error.message);
  } finally {
    pool.end();
  }
}

backupDatabase();
