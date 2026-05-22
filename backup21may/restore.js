/**
 * LeadFlow Database Restore Script
 * Restores the full database from backup21may exports
 * 
 * Usage:
 *   1. Set NEW_DATABASE_URL in your .env (or pass as env variable)
 *   2. node backup21may/restore.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ⚠️ CHANGE THIS to your NEW database URL before running!
const NEW_DB_URL = process.env.NEW_DATABASE_URL || process.env.DATABASE_URL;

async function restore() {
  console.log('🔄 Starting database restore...');
  console.log('⚠️  Target DB:', NEW_DB_URL.replace(/:[^:@]+@/, ':****@'));

  const pool = new Pool({
    connectionString: NEW_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();

  try {
    // Step 1: Run schema
    console.log('\n📐 Creating schema...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    console.log('   ✅ Schema created');

    // Step 2: Insert data
    console.log('\n📦 Inserting data...');
    const dataSql = fs.readFileSync(path.join(__dirname, 'data_inserts.sql'), 'utf8');
    await client.query(dataSql);
    console.log('   ✅ Data inserted');

    // Step 3: Verify
    console.log('\n🔍 Verifying...');
    const tables = ["users","leads","lead_history","lead_notes","note_edits","reminders","board_users","boards","lead_visits","settings","visit_participants"];
    for (const table of tables) {
      const res = await client.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`   ${table}: ${res.rows[0].count} rows`);
    }

    console.log('\n✅ Restore complete!');
  } catch (err) {
    console.error('❌ Restore failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

restore();
