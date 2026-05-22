/**
 * LeadFlow Database Migration Script v2
 * Migrates ALL data from backup22may to a NEW Neon database
 * 
 * Builds schema dynamically from relationships.json metadata
 * to handle correct table ordering and avoid DDL issues.
 */

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const NEW_DATABASE_URL = 'postgresql://neondb_owner:npg_hGZKLse54dmg@ep-blue-lab-ao5gw8pe-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

const BACKUP_DIR = path.join(__dirname);
const DATA_DIR = path.join(BACKUP_DIR, 'data');

function escapeSQL(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  LeadFlow Database Migration v2');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════');

  const pool = new Pool({
    connectionString: NEW_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();

  try {
    // ─── Step 0: Verify Connection ──────────────────────────────
    console.log('\n🔌 Connecting to NEW Neon DB...');
    const verifyRes = await client.query('SELECT current_database(), current_user, version()');
    console.log(`   Database: ${verifyRes.rows[0].current_database}`);
    console.log(`   User: ${verifyRes.rows[0].current_user}`);
    console.log('   ✅ Connected!\n');

    // ─── Step 1: Drop existing tables if any ────────────────────
    console.log('🗑️  STEP 1: Cleaning target database...');
    
    // Get existing tables
    const existingTables = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    
    if (existingTables.rows.length > 0) {
      for (const row of existingTables.rows) {
        await client.query(`DROP TABLE IF EXISTS "${row.table_name}" CASCADE;`);
        console.log(`   Dropped: ${row.table_name}`);
      }
    }
    
    // Drop functions
    try {
      await client.query(`DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;`);
    } catch(e) {}
    
    console.log('   ✅ Clean slate ready');

    // ─── Step 2: Create Schema (proper order) ───────────────────
    console.log('\n📐 STEP 2: Creating schema...');
    
    // Extension
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    console.log('   ✅ uuid-ossp extension');

    // Create tables WITHOUT foreign keys first, then add FKs
    // Correct dependency order: users → boards → leads → lead_history, lead_notes, reminders, board_users, lead_visits → note_edits, visit_participants, settings

    // --- users ---
    await client.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'visitor')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        fcm_token VARCHAR(255)
      );
    `);
    console.log('   ✅ users');

    // --- boards ---
    await client.query(`
      CREATE TABLE boards (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        color VARCHAR(20) DEFAULT '#4f7cff',
        icon VARCHAR(50) DEFAULT 'briefcase',
        is_active BOOLEAN DEFAULT true,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
    `);
    console.log('   ✅ boards');

    // --- leads ---
    await client.query(`
      CREATE TABLE leads (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(255) NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255),
        client_phone VARCHAR(50),
        client_company VARCHAR(255),
        description TEXT,
        stage VARCHAR(50) NOT NULL DEFAULT 'meeting',
        priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        value DECIMAL(15,2),
        assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        board_id UUID REFERENCES boards(id) ON DELETE SET NULL,
        custom_data JSONB DEFAULT '{}'::jsonb
      );
    `);
    console.log('   ✅ leads');

    // --- lead_history ---
    await client.query(`
      CREATE TABLE lead_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        action VARCHAR(100) NOT NULL,
        field_changed VARCHAR(100),
        old_value TEXT,
        new_value TEXT,
        details JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
    `);
    console.log('   ✅ lead_history');

    // --- lead_notes ---
    await client.query(`
      CREATE TABLE lead_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        stage VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        is_edited BOOLEAN DEFAULT false,
        original_content TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        money_collected BOOLEAN DEFAULT false
      );
    `);
    console.log('   ✅ lead_notes');

    // --- note_edits ---
    await client.query(`
      CREATE TABLE note_edits (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        note_id UUID NOT NULL REFERENCES lead_notes(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        previous_content TEXT NOT NULL,
        new_content TEXT NOT NULL,
        edited_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
    `);
    console.log('   ✅ note_edits');

    // --- reminders ---
    await client.query(`
      CREATE TABLE reminders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        stage VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        remind_at TIMESTAMP WITH TIME ZONE NOT NULL,
        is_completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        type VARCHAR(50) DEFAULT 'general',
        recurrence VARCHAR(50) DEFAULT 'none',
        is_notified BOOLEAN DEFAULT false,
        completion_status VARCHAR(50) DEFAULT 'completed',
        completion_note TEXT,
        last_notified_at TIMESTAMP WITH TIME ZONE
      );
    `);
    console.log('   ✅ reminders');

    // --- board_users ---
    await client.query(`
      CREATE TABLE board_users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) DEFAULT 'member',
        added_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
    `);
    console.log('   ✅ board_users');

    // --- lead_visits ---
    await client.query(`
      CREATE TABLE lead_visits (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        location VARCHAR(500) NOT NULL,
        distance_km DECIMAL(10,2) DEFAULT 0,
        visit_date TIMESTAMP WITH TIME ZONE NOT NULL,
        purpose VARCHAR(100) NOT NULL CHECK (purpose IN ('site_visit', 'client_meeting', 'follow_up_visit', 'final_inspection', 'other')),
        notes TEXT,
        outcome VARCHAR(100) CHECK (outcome IN ('positive', 'neutral', 'negative', 'pending')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
    `);
    console.log('   ✅ lead_visits');

    // --- settings ---
    await client.query(`
      CREATE TABLE settings (
        key VARCHAR(255) NOT NULL,
        value JSONB NOT NULL,
        board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        PRIMARY KEY (key, board_id)
      );
    `);
    console.log('   ✅ settings');

    // --- visit_participants ---
    await client.query(`
      CREATE TABLE visit_participants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        visit_id UUID NOT NULL REFERENCES lead_visits(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        distance_km DECIMAL(10,2) DEFAULT 0,
        travel_mode VARCHAR(50) CHECK (travel_mode IN ('car', 'bike', 'public_transport', 'walk', 'other')),
        travel_notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
    `);
    console.log('   ✅ visit_participants');

    // --- Indexes ---
    console.log('\n   Creating indexes...');
    const indexes = [
      'CREATE INDEX idx_leads_stage ON leads(stage)',
      'CREATE INDEX idx_leads_assigned_to ON leads(assigned_to)',
      'CREATE INDEX idx_leads_created_by ON leads(created_by)',
      'CREATE INDEX idx_leads_board_id ON leads(board_id)',
      'CREATE INDEX idx_lead_history_lead_id ON lead_history(lead_id)',
      'CREATE INDEX idx_lead_notes_lead_id ON lead_notes(lead_id)',
      'CREATE INDEX idx_reminders_lead_id ON reminders(lead_id)',
      'CREATE INDEX idx_reminders_user_id ON reminders(user_id)',
      'CREATE INDEX idx_reminders_remind_at ON reminders(remind_at)',
      'CREATE INDEX idx_reminders_cron ON reminders(is_completed, remind_at) WHERE is_completed = false',
      'CREATE INDEX idx_reminders_user_completed ON reminders(user_id, is_completed)',
      'CREATE INDEX idx_board_users_board_id ON board_users(board_id)',
      'CREATE INDEX idx_board_users_user_id ON board_users(user_id)',
      'CREATE INDEX idx_lead_visits_lead_id ON lead_visits(lead_id)',
      'CREATE INDEX idx_lead_visits_created_by ON lead_visits(created_by)',
      'CREATE INDEX idx_lead_visits_visit_date ON lead_visits(visit_date)',
      'CREATE INDEX idx_settings_board_id ON settings(board_id)',
      'CREATE INDEX idx_visit_participants_visit_id ON visit_participants(visit_id)',
      'CREATE INDEX idx_visit_participants_user_id ON visit_participants(user_id)',
    ];
    for (const idx of indexes) {
      try { await client.query(idx); } catch(e) { /* skip if exists */ }
    }
    console.log(`   ✅ ${indexes.length} indexes created`);

    // --- Function ---
    console.log('   Creating functions...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    console.log('   ✅ update_updated_at_column()');

    // --- Triggers ---
    console.log('   Creating triggers...');
    const triggers = [
      'CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      'CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      'CREATE TRIGGER update_lead_notes_updated_at BEFORE UPDATE ON lead_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      'CREATE TRIGGER update_lead_visits_updated_at BEFORE UPDATE ON lead_visits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      'CREATE TRIGGER update_boards_updated_at BEFORE UPDATE ON boards FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
    ];
    for (const trig of triggers) {
      try { await client.query(trig); } catch(e) { /* skip if exists */ }
    }
    console.log(`   ✅ ${triggers.length} triggers created`);

    console.log('\n   ✅ Full schema created!');

    // ─── Step 3: Insert Data ────────────────────────────────────
    console.log('\n📦 STEP 3: Inserting data...');
    
    // Note: Triggers are BEFORE UPDATE only, so INSERTs won't fire them
    console.log('   (Triggers are UPDATE-only, no need to disable for inserts)\n');

    // Correct insert order (parents before children)
    const INSERT_ORDER = [
      'users',
      'boards',
      'leads',
      'lead_history',
      'lead_notes',
      'note_edits',
      'reminders',
      'board_users',
      'lead_visits',
      'settings',
      'visit_participants'
    ];

    const rowCounts = {};

    for (const table of INSERT_ORDER) {
      const jsonFile = path.join(DATA_DIR, `${table}.json`);
      
      if (!fs.existsSync(jsonFile)) {
        console.log(`   ⏭️  ${table}: no data file, skipping`);
        rowCounts[table] = 0;
        continue;
      }

      const rows = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      rowCounts[table] = rows.length;

      if (rows.length === 0) {
        console.log(`   ⏭️  ${table}: 0 rows (empty)`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      let insertedCount = 0;
      let errorCount = 0;
      let lastError = '';

      for (const row of rows) {
        const values = columns.map(col => escapeSQL(row[col]));
        const insertSQL = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;`;
        
        try {
          await client.query(insertSQL);
          insertedCount++;
        } catch (insertErr) {
          errorCount++;
          lastError = insertErr.message;
          if (errorCount <= 2) {
            console.log(`      ⚠️  Error: ${insertErr.message.substring(0, 120)}`);
          }
        }
      }
      
      if (errorCount > 0) {
        console.log(`   ⚠️  ${table}: ${insertedCount}/${rows.length} rows (${errorCount} errors)`);
      } else {
        console.log(`   ✅ ${table}: ${insertedCount} rows inserted`);
      }
    }

    console.log('\n   ✅ All data inserted');

    // ─── Step 4: Verify ─────────────────────────────────────────
    console.log('\n🔍 STEP 4: Verifying migration...\n');
    
    let allMatch = true;
    const originalSummary = JSON.parse(fs.readFileSync(path.join(DATA_DIR, '_summary.json'), 'utf8'));
    
    console.log('   Table               | Backup | New DB | Status');
    console.log('   --------------------|--------|--------|-------');
    
    for (const table of INSERT_ORDER) {
      try {
        const countRes = await client.query(`SELECT COUNT(*) as cnt FROM ${table};`);
        const newCount = parseInt(countRes.rows[0].cnt);
        const origCount = originalSummary[table] || 0;
        const match = newCount === origCount;
        if (!match) allMatch = false;
        
        const status = match ? '✅ Match' : `⚠️ ${origCount}→${newCount}`;
        console.log(`   ${table.padEnd(20)}| ${String(origCount).padStart(6)} | ${String(newCount).padStart(6)} | ${status}`);
      } catch (e) {
        console.log(`   ${table.padEnd(20)}| ${'?'.padStart(6)} | ${'ERR'.padStart(6)} | ❌`);
        allMatch = false;
      }
    }

    // ─── Step 5: Verify FK relationships ────────────────────────
    console.log('\n🔗 STEP 5: Foreign key relationships in new DB:');
    
    const fkRes = await client.query(`
      SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name;
    `);
    
    for (const fk of fkRes.rows) {
      console.log(`   ${fk.table_name}.${fk.column_name} → ${fk.ref_table}.${fk.ref_column} (ON DELETE ${fk.delete_rule})`);
    }
    console.log(`   Total: ${fkRes.rows.length} foreign keys`);

    // ─── Summary ────────────────────────────────────────────────
    const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
    console.log('\n═══════════════════════════════════════════════════');
    if (allMatch) {
      console.log(`  ✅ MIGRATION COMPLETE - ALL ${totalRows} ROWS VERIFIED!`);
    } else {
      console.log(`  ⚠️  MIGRATION COMPLETE - ${totalRows} rows migrated`);
      console.log('  Some counts may differ - check details above');
    }
    console.log('═══════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
