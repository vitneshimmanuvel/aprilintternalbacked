const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// ── New backup database connection ──
const BACKUP_DB_URL = 'postgresql://neondb_owner:npg_3hH1MkTfboCA@ep-small-feather-a1ng6nmh-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
  connectionString: BACKUP_DB_URL,
  ssl: { rejectUnauthorized: false },
});

// Find the latest backup file
function getLatestBackup() {
  const backupDir = path.join(__dirname, '../backup');
  if (!fs.existsSync(backupDir)) {
    console.error('❌ No backup folder found at:', backupDir);
    process.exit(1);
  }
  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.json') && f.startsWith('neon_db_backup_'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error('❌ No backup JSON files found in:', backupDir);
    process.exit(1);
  }
  return path.join(backupDir, files[0]);
}

async function restore() {
  const client = await pool.connect();
  const backupFile = getLatestBackup();
  console.log('====================================');
  console.log('  LeadFlow DB Restore to New Neon DB');
  console.log('====================================');
  console.log(`📂 Using backup: ${path.basename(backupFile)}\n`);

  try {
    // ── Step 1: Drop existing tables ──
    console.log('🗑️  Dropping existing tables (if any)...');
    await client.query(`
      DROP TABLE IF EXISTS note_edits CASCADE;
      DROP TABLE IF EXISTS reminders CASCADE;
      DROP TABLE IF EXISTS lead_notes CASCADE;
      DROP TABLE IF EXISTS lead_history CASCADE;
      DROP TABLE IF EXISTS leads CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
    `);
    console.log('✅ Old tables dropped\n');

    // ── Step 2: Create tables WITHOUT foreign keys first ──
    console.log('📄 Creating database tables...');
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'visitor')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE leads (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(255) NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255),
        client_phone VARCHAR(50),
        client_company VARCHAR(255),
        description TEXT,
        stage VARCHAR(50) NOT NULL DEFAULT 'meeting' CHECK (
          stage IN ('meeting', 'followup', 'negotiation', 'estimation_review', 'finalization', 'cancelled')
        ),
        priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        value DECIMAL(15,2),
        assigned_to UUID,
        created_by UUID NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE lead_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lead_id UUID NOT NULL,
        user_id UUID NOT NULL,
        action VARCHAR(100) NOT NULL,
        field_changed VARCHAR(100),
        old_value TEXT,
        new_value TEXT,
        details JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE lead_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lead_id UUID NOT NULL,
        user_id UUID NOT NULL,
        stage VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        is_edited BOOLEAN DEFAULT false,
        original_content TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE note_edits (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        note_id UUID NOT NULL,
        user_id UUID NOT NULL,
        previous_content TEXT NOT NULL,
        new_content TEXT NOT NULL,
        edited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE reminders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lead_id UUID NOT NULL,
        user_id UUID NOT NULL,
        stage VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(50) DEFAULT 'general',
        recurrence VARCHAR(50) DEFAULT 'none',
        remind_at TIMESTAMP WITH TIME ZONE NOT NULL,
        is_completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMP WITH TIME ZONE,
        completion_status VARCHAR(50),
        completion_note TEXT,
        is_notified BOOLEAN DEFAULT false,
        last_notified_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ Tables created (no FK constraints yet)\n');

    // ── Step 3: Load and insert backup data ──
    console.log('📦 Loading backup data...');
    const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'));

    const insertOrder = ['users', 'leads', 'lead_history', 'lead_notes', 'note_edits', 'reminders'];

    for (const table of insertOrder) {
      const rows = backupData[table];
      if (!rows || rows.length === 0) {
        console.log(`   ⏭️  ${table}: 0 rows (skipped)`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      let insertedCount = 0;

      for (const row of rows) {
        const values = columns.map((_, i) => `$${i + 1}`).join(', ');
        const data = columns.map(col => {
          const val = row[col];
          if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
            return JSON.stringify(val);
          }
          return val;
        });

        try {
          await client.query(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values})`,
            data
          );
          insertedCount++;
        } catch (err) {
          console.error(`   ⚠️  [${table}] Error: ${err.message.split('\n')[0]}`);
        }
      }
      console.log(`   ✅ ${table}: ${insertedCount}/${rows.length} rows inserted`);
    }

    // ── Step 4: Now add foreign key constraints ──
    console.log('\n🔗 Adding foreign key constraints...');
    await client.query(`
      ALTER TABLE leads ADD CONSTRAINT leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE leads ADD CONSTRAINT leads_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;

      ALTER TABLE lead_history ADD CONSTRAINT lead_history_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
      ALTER TABLE lead_history ADD CONSTRAINT lead_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

      ALTER TABLE lead_notes ADD CONSTRAINT lead_notes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
      ALTER TABLE lead_notes ADD CONSTRAINT lead_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

      ALTER TABLE note_edits ADD CONSTRAINT note_edits_note_id_fkey FOREIGN KEY (note_id) REFERENCES lead_notes(id) ON DELETE CASCADE;
      ALTER TABLE note_edits ADD CONSTRAINT note_edits_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

      ALTER TABLE reminders ADD CONSTRAINT reminders_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
      ALTER TABLE reminders ADD CONSTRAINT reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
    `);
    console.log('✅ Foreign key constraints added');

    // ── Step 5: Add indexes ──
    console.log('\n📇 Adding indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
      CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);
      CREATE INDEX IF NOT EXISTS idx_lead_history_lead_id ON lead_history(lead_id);
      CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id ON lead_notes(lead_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_lead_id ON reminders(lead_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);
    `);
    console.log('✅ Indexes created');

    // ── Step 6: Add triggers ──
    console.log('\n⚡ Adding update triggers...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql';

      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_lead_notes_updated_at BEFORE UPDATE ON lead_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    console.log('✅ Triggers created');

    // ── Step 7: Verify ──
    console.log('\n📊 Verification - Row counts in new database:');
    console.log('  ┌──────────────────┬───────────┐');
    console.log('  │ Table            │ Rows      │');
    console.log('  ├──────────────────┼───────────┤');
    for (const table of insertOrder) {
      const { rows } = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`  │ ${table.padEnd(16)} │ ${String(rows[0].count).padStart(9)} │`);
    }
    console.log('  └──────────────────┴───────────┘');

    console.log('\n====================================');
    console.log('  🎉 RESTORE COMPLETE!');
    console.log('  All tables, data, indexes,');
    console.log('  constraints & triggers restored.');
    console.log('====================================\n');

  } catch (err) {
    console.error('\n❌ Restore failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

restore().catch(() => process.exit(1));
