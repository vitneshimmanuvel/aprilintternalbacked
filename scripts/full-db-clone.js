const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// ── Source (live) and Target (backup) databases ──
const SOURCE_URL = process.env.DATABASE_URL;
const TARGET_URL = 'postgresql://neondb_owner:npg_3hH1MkTfboCA@ep-small-feather-a1ng6nmh-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

const sourcePool = new Pool({ connectionString: SOURCE_URL, ssl: { rejectUnauthorized: false } });
const targetPool = new Pool({ connectionString: TARGET_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const src = await sourcePool.connect();
  const tgt = await targetPool.connect();

  console.log('=============================================');
  console.log('  LeadFlow FULL Database Clone');
  console.log('  Live DB  →  Backup Neon DB');
  console.log('=============================================\n');

  try {
    // ── Step 1: Get ALL tables from the live database ──
    console.log('📋 Step 1: Reading all tables from live database...');
    const { rows: tableRows } = await src.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const tableNames = tableRows.map(r => r.table_name);
    console.log(`   Found ${tableNames.length} tables: ${tableNames.join(', ')}\n`);

    // ── Step 2: Get full CREATE TABLE DDL for each table ──
    console.log('📋 Step 2: Reading column definitions from live database...');
    const tableSchemas = {};
    for (const table of tableNames) {
      const { rows: colRows } = await src.query(`
        SELECT column_name, data_type, character_maximum_length, 
               column_default, is_nullable, udt_name,
               numeric_precision, numeric_scale
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [table]);
      tableSchemas[table] = colRows;
      console.log(`   ${table}: ${colRows.length} columns → [${colRows.map(c => c.column_name).join(', ')}]`);
    }

    // ── Step 3: Get all constraints (PK, FK, UNIQUE, CHECK) ──
    console.log('\n📋 Step 3: Reading constraints...');
    const { rows: constraints } = await src.query(`
      SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
             kcu.column_name,
             ccu.table_name AS foreign_table_name,
             ccu.column_name AS foreign_column_name,
             rc.update_rule, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      LEFT JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name AND tc.constraint_schema = rc.constraint_schema
      WHERE tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_type;
    `);
    console.log(`   Found ${constraints.length} constraint entries`);

    // ── Step 4: Get check constraints ──
    const { rows: checkConstraints } = await src.query(`
      SELECT conname, conrelid::regclass AS table_name, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE contype = 'c' AND connamespace = 'public'::regnamespace;
    `);
    console.log(`   Found ${checkConstraints.length} check constraints`);

    // ── Step 5: Get indexes ──
    const { rows: indexes } = await src.query(`
      SELECT indexname, indexdef FROM pg_indexes 
      WHERE schemaname = 'public' AND indexname NOT LIKE '%_pkey';
    `);
    console.log(`   Found ${indexes.length} indexes`);

    // ── Step 6: Get all data from all tables ──
    console.log('\n📦 Step 4: Downloading all data from live database...');
    const allData = {};
    for (const table of tableNames) {
      const { rows } = await src.query(`SELECT * FROM "${table}"`);
      allData[table] = rows;
      console.log(`   ${table}: ${rows.length} rows`);
    }

    // ── Save full backup to file ──
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, '../backup');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    const backupFile = path.join(backupDir, `full_clone_backup_${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({
      timestamp,
      tableSchemas,
      allData,
      constraints,
      checkConstraints,
      indexes
    }, null, 2));
    console.log(`\n💾 Full backup saved: ${path.basename(backupFile)}`);

    // ══════════════════════════════════════════════
    // NOW RESTORE TO TARGET DATABASE
    // ══════════════════════════════════════════════
    console.log('\n══════════════════════════════════════');
    console.log('  RESTORING TO BACKUP DATABASE...');
    console.log('══════════════════════════════════════\n');

    // ── Drop everything in target ──
    console.log('🗑️  Dropping all existing tables in target...');
    for (const table of [...tableNames].reverse()) {
      await tgt.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    await tgt.query(`DROP FUNCTION IF EXISTS update_updated_at_column CASCADE`);
    console.log('✅ Cleaned target database\n');

    // ── Create extension ──
    await tgt.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── Create tables (NO constraints, just columns) ──
    console.log('📄 Creating tables...');
    for (const table of tableNames) {
      const cols = tableSchemas[table];
      const colDefs = cols.map(c => {
        let type = c.data_type;
        // Map proper types
        if (c.udt_name === 'uuid') type = 'UUID';
        else if (c.udt_name === 'int4') type = 'INTEGER';
        else if (c.udt_name === 'int8') type = 'BIGINT';
        else if (c.udt_name === 'bool') type = 'BOOLEAN';
        else if (c.udt_name === 'text') type = 'TEXT';
        else if (c.udt_name === 'jsonb') type = 'JSONB';
        else if (c.udt_name === 'json') type = 'JSON';
        else if (c.udt_name === 'timestamptz') type = 'TIMESTAMP WITH TIME ZONE';
        else if (c.udt_name === 'timestamp') type = 'TIMESTAMP';
        else if (c.udt_name === 'varchar') type = `VARCHAR(${c.character_maximum_length || 255})`;
        else if (c.udt_name === 'numeric') type = `DECIMAL(${c.numeric_precision || 15},${c.numeric_scale || 2})`;
        else if (c.udt_name === 'float8') type = 'DOUBLE PRECISION';
        else if (c.udt_name === 'float4') type = 'REAL';

        let def = `"${c.column_name}" ${type}`;
        if (c.column_default) def += ` DEFAULT ${c.column_default}`;
        if (c.is_nullable === 'NO') def += ' NOT NULL';
        return def;
      }).join(',\n    ');

      const sql = `CREATE TABLE "${table}" (\n    ${colDefs}\n  )`;
      try {
        await tgt.query(sql);
        console.log(`   ✅ Created: ${table}`);
      } catch (err) {
        console.error(`   ❌ Failed: ${table} → ${err.message}`);
      }
    }

    // ── Insert ALL data ──
    console.log('\n📦 Inserting data...');
    // Determine insert order: users first, then leads, then others
    const insertOrder = ['users', ...tableNames.filter(t => t === 'leads'), ...tableNames.filter(t => t !== 'users' && t !== 'leads')];
    const uniqueOrder = [...new Set(insertOrder)];

    for (const table of uniqueOrder) {
      const rows = allData[table];
      if (!rows || rows.length === 0) {
        console.log(`   ⏭️  ${table}: 0 rows`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      let inserted = 0;

      for (const row of rows) {
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const values = columns.map(col => {
          const val = row[col];
          if (val !== null && typeof val === 'object' && !(val instanceof Date) && !Array.isArray(val)) {
            return JSON.stringify(val);
          }
          return val;
        });

        const quotedCols = columns.map(c => `"${c}"`).join(', ');
        try {
          await tgt.query(`INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders})`, values);
          inserted++;
        } catch (err) {
          console.error(`   ⚠️  [${table}] Row error: ${err.message.split('\n')[0]}`);
        }
      }
      console.log(`   ✅ ${table}: ${inserted}/${rows.length} rows`);
    }

    // ── Add primary keys ──
    console.log('\n🔑 Adding primary keys...');
    const pkMap = {};
    constraints.filter(c => c.constraint_type === 'PRIMARY KEY').forEach(c => {
      pkMap[c.table_name] = c.column_name;
    });
    for (const [table, col] of Object.entries(pkMap)) {
      try {
        await tgt.query(`ALTER TABLE "${table}" ADD PRIMARY KEY ("${col}")`);
        console.log(`   ✅ PK on ${table}(${col})`);
      } catch (err) {
        console.log(`   ⏭️  PK on ${table}: ${err.message.split('\n')[0]}`);
      }
    }

    // ── Add unique constraints ──
    console.log('\n🔒 Adding unique constraints...');
    const uniqueConstraints = constraints.filter(c => c.constraint_type === 'UNIQUE');
    for (const uc of uniqueConstraints) {
      try {
        await tgt.query(`ALTER TABLE "${uc.table_name}" ADD CONSTRAINT "${uc.constraint_name}" UNIQUE ("${uc.column_name}")`);
        console.log(`   ✅ UNIQUE on ${uc.table_name}(${uc.column_name})`);
      } catch (err) {
        console.log(`   ⏭️  UNIQUE ${uc.constraint_name}: ${err.message.split('\n')[0]}`);
      }
    }

    // ── Add foreign keys ──
    console.log('\n🔗 Adding foreign keys...');
    const fkConstraints = constraints.filter(c => c.constraint_type === 'FOREIGN KEY');
    for (const fk of fkConstraints) {
      const onDelete = fk.delete_rule ? `ON DELETE ${fk.delete_rule}` : '';
      try {
        await tgt.query(`ALTER TABLE "${fk.table_name}" ADD CONSTRAINT "${fk.constraint_name}" FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table_name}"("${fk.foreign_column_name}") ${onDelete}`);
        console.log(`   ✅ FK: ${fk.table_name}(${fk.column_name}) → ${fk.foreign_table_name}(${fk.foreign_column_name})`);
      } catch (err) {
        console.log(`   ⚠️  FK ${fk.constraint_name}: ${err.message.split('\n')[0]}`);
      }
    }

    // ── Add check constraints ──
    console.log('\n✅ Adding check constraints...');
    for (const cc of checkConstraints) {
      try {
        await tgt.query(`ALTER TABLE ${cc.table_name} ADD CONSTRAINT "${cc.conname}" ${cc.definition}`);
        console.log(`   ✅ CHECK: ${cc.table_name} → ${cc.conname}`);
      } catch (err) {
        console.log(`   ⏭️  CHECK ${cc.conname}: ${err.message.split('\n')[0]}`);
      }
    }

    // ── Add indexes ──
    console.log('\n📇 Creating indexes...');
    for (const idx of indexes) {
      try {
        await tgt.query(idx.indexdef);
        console.log(`   ✅ ${idx.indexname}`);
      } catch (err) {
        console.log(`   ⏭️  ${idx.indexname}: ${err.message.split('\n')[0]}`);
      }
    }

    // ── Add triggers/functions ──
    console.log('\n⚡ Creating triggers...');
    try {
      await tgt.query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
        $$ language 'plpgsql';
      `);
      for (const table of tableNames) {
        const hasUpdatedAt = tableSchemas[table].some(c => c.column_name === 'updated_at');
        if (hasUpdatedAt) {
          try {
            await tgt.query(`CREATE TRIGGER update_${table}_updated_at BEFORE UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`);
            console.log(`   ✅ Trigger on ${table}`);
          } catch (err) { /* skip if exists */ }
        }
      }
    } catch (err) {
      console.log(`   ⚠️  Trigger setup: ${err.message}`);
    }

    // ── Final verification ──
    console.log('\n📊 VERIFICATION — Row counts in backup database:');
    console.log('  ┌────────────────────┬───────────┬───────────┐');
    console.log('  │ Table              │ Live DB   │ Backup DB │');
    console.log('  ├────────────────────┼───────────┼───────────┤');
    for (const table of tableNames) {
      const { rows: srcCount } = await src.query(`SELECT COUNT(*) as c FROM "${table}"`);
      const { rows: tgtCount } = await tgt.query(`SELECT COUNT(*) as c FROM "${table}"`);
      const match = srcCount[0].c === tgtCount[0].c ? '✅' : '❌';
      console.log(`  │ ${table.padEnd(18)} │ ${String(srcCount[0].c).padStart(9)} │ ${String(tgtCount[0].c).padStart(9)} │ ${match}`);
    }
    console.log('  └────────────────────┴───────────┴───────────┘');

    console.log('\n=============================================');
    console.log('  🎉 FULL DATABASE CLONE COMPLETE!');
    console.log('  Structure + Data + Constraints + Indexes');
    console.log('=============================================\n');

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
  } finally {
    src.release();
    tgt.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

run();
