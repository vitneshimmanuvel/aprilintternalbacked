/**
 * Migration Script: Single Board → Multi-Board Architecture
 * 
 * This script:
 * 1. Creates the `boards` table
 * 2. Creates the `board_users` table
 * 3. Adds `board_id` to `leads` and `settings` tables
 * 4. Creates a default board and assigns all existing data to it
 * 5. Assigns all existing users to the default board
 * 
 * Run: node scripts/migrate-multiboard.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🚀 Starting Multi-Board Migration...\n');

    // ─── 1. Create boards table ────────────────────────────────────
    console.log('📋 Creating boards table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS boards (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        color VARCHAR(20) DEFAULT '#4f7cff',
        icon VARCHAR(50) DEFAULT 'briefcase',
        is_active BOOLEAN DEFAULT true,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('   ✅ boards table created');

    // ─── 2. Create board_users table ───────────────────────────────
    console.log('📋 Creating board_users table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS board_users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) DEFAULT 'member',
        added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(board_id, user_id)
      );
    `);
    console.log('   ✅ board_users table created');

    // ─── 3. Add board_id to leads ──────────────────────────────────
    console.log('📋 Adding board_id to leads...');
    const leadsColCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'leads' AND column_name = 'board_id'
    `);
    if (leadsColCheck.rows.length === 0) {
      await client.query(`ALTER TABLE leads ADD COLUMN board_id UUID REFERENCES boards(id) ON DELETE SET NULL`);
      console.log('   ✅ board_id column added to leads');
    } else {
      console.log('   ⏭️  board_id already exists on leads');
    }

    // ─── 4. Add board_id to settings ───────────────────────────────
    console.log('📋 Adding board_id to settings...');
    const settingsColCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'settings' AND column_name = 'board_id'
    `);
    if (settingsColCheck.rows.length === 0) {
      await client.query(`ALTER TABLE settings ADD COLUMN board_id UUID REFERENCES boards(id) ON DELETE CASCADE`);
      console.log('   ✅ board_id column added to settings');
    } else {
      console.log('   ⏭️  board_id already exists on settings');
    }

    // ─── 5. Create a default board ─────────────────────────────────
    console.log('📋 Creating default board...');
    const existingBoard = await client.query(`SELECT id FROM boards WHERE slug = 'default'`);
    let defaultBoardId;
    
    if (existingBoard.rows.length === 0) {
      // Get admin user ID
      const admin = await client.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
      const adminId = admin.rows[0]?.id || null;

      const boardResult = await client.query(`
        INSERT INTO boards (name, slug, description, color, icon, created_by)
        VALUES ('Settlo', 'default', 'Default workspace — migrated from single-board setup', '#4f7cff', 'briefcase', $1)
        RETURNING id
      `, [adminId]);
      defaultBoardId = boardResult.rows[0].id;
      console.log(`   ✅ Default board created: ${defaultBoardId}`);
    } else {
      defaultBoardId = existingBoard.rows[0].id;
      console.log(`   ⏭️  Default board already exists: ${defaultBoardId}`);
    }

    // ─── 6. Assign all existing leads to the default board ─────────
    console.log('📋 Assigning existing leads to default board...');
    const updateResult = await client.query(
      `UPDATE leads SET board_id = $1 WHERE board_id IS NULL`,
      [defaultBoardId]
    );
    console.log(`   ✅ ${updateResult.rowCount} leads updated`);

    // ─── 7. Assign all existing settings to the default board ──────
    console.log('📋 Assigning existing settings to default board...');
    const settingsUpdate = await client.query(
      `UPDATE settings SET board_id = $1 WHERE board_id IS NULL`,
      [defaultBoardId]
    );
    console.log(`   ✅ ${settingsUpdate.rowCount} settings updated`);

    // ─── 8. Assign all users to the default board ──────────────────
    console.log('📋 Assigning all users to default board...');
    const allUsers = await client.query(`SELECT id, role FROM users`);
    let assignedCount = 0;
    for (const user of allUsers.rows) {
      const exists = await client.query(
        `SELECT id FROM board_users WHERE board_id = $1 AND user_id = $2`,
        [defaultBoardId, user.id]
      );
      if (exists.rows.length === 0) {
        await client.query(
          `INSERT INTO board_users (board_id, user_id, role) VALUES ($1, $2, $3)`,
          [defaultBoardId, user.id, user.role === 'admin' ? 'admin' : 'member']
        );
        assignedCount++;
      }
    }
    console.log(`   ✅ ${assignedCount} users assigned to default board`);

    // ─── 9. Create indexes ─────────────────────────────────────────
    console.log('📋 Creating indexes...');
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_board_id ON leads(board_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_board_users_board_id ON board_users(board_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_board_users_user_id ON board_users(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_settings_board_id ON settings(board_id)`);
    console.log('   ✅ Indexes created');

    // ─── 10. Add trigger for boards updated_at ─────────────────────
    await client.query(`
      CREATE TRIGGER update_boards_updated_at 
      BEFORE UPDATE ON boards 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `).catch(() => { /* trigger may already exist */ });

    // ─── 11. Remove the stage CHECK constraint from leads ──────────
    // This allows board-specific custom stages
    console.log('📋 Removing rigid stage CHECK constraint from leads...');
    try {
      await client.query(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check`);
      console.log('   ✅ Stage constraint removed — boards can now use custom stages');
    } catch (e) {
      console.log('   ⏭️  No stage constraint to remove');
    }

    await client.query('COMMIT');
    console.log('\n🎉 Multi-Board Migration Complete!');
    console.log(`   Default Board ID: ${defaultBoardId}`);
    console.log('   All existing data has been preserved.\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
