/**
 * LeadFlow Neon DB Full Export Script
 * Exports everything from the Neon database:
 *   - Full schema DDL (CREATE TABLE, indexes, triggers, functions)
 *   - All data as JSON files (one per table)
 *   - All data as SQL INSERT statements (for easy restore)
 *   - Relationship & constraint metadata
 *   - Summary report
 * 
 * Output goes to: d:\leadflow\backend\backup21may\
 */

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
const BACKUP_DIR = __dirname; // backup21may folder

// All known tables in dependency order (parents first)
const TABLES_IN_ORDER = [
  'users',
  'leads',
  'lead_history',
  'lead_notes',
  'note_edits',
  'reminders'
];

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Helpers ────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeSQL(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

// ─── 1. Export Schema DDL ───────────────────────────────────────────

async function exportSchema(client) {
  console.log('\n📐 Exporting schema DDL...');
  let ddl = '';

  // Extensions
  const extRes = await client.query(`SELECT extname FROM pg_extension WHERE extname != 'plpgsql';`);
  for (const row of extRes.rows) {
    ddl += `CREATE EXTENSION IF NOT EXISTS "${row.extname}";\n`;
  }
  ddl += '\n';

  // Table definitions
  for (const table of TABLES_IN_ORDER) {
    ddl += `-- ========================================\n`;
    ddl += `-- Table: ${table}\n`;
    ddl += `-- ========================================\n`;

    // Get columns
    const colRes = await client.query(`
      SELECT column_name, data_type, character_maximum_length, 
             column_default, is_nullable, udt_name,
             numeric_precision, numeric_scale
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position;
    `, [table]);

    // Get check constraints
    const checkRes = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'c';
    `, [table]);

    // Get primary key
    const pkRes = await client.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary;
    `, [table]);
    const pkColumns = pkRes.rows.map(r => r.attname);

    // Get foreign keys
    const fkRes = await client.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints AS rc ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1;
    `, [table]);

    // Get unique constraints
    const uniqRes = await client.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisunique AND NOT i.indisprimary;
    `, [table]);

    // Build CREATE TABLE
    ddl += `CREATE TABLE ${table} (\n`;
    const colDefs = [];
    for (const col of colRes.rows) {
      let typeName = col.data_type;
      if (col.data_type === 'character varying') typeName = `VARCHAR(${col.character_maximum_length || 255})`;
      else if (col.data_type === 'uuid') typeName = 'UUID';
      else if (col.data_type === 'text') typeName = 'TEXT';
      else if (col.data_type === 'boolean') typeName = 'BOOLEAN';
      else if (col.data_type === 'numeric') typeName = `DECIMAL(${col.numeric_precision},${col.numeric_scale})`;
      else if (col.data_type === 'timestamp with time zone') typeName = 'TIMESTAMP WITH TIME ZONE';
      else if (col.data_type === 'jsonb') typeName = 'JSONB';
      else if (col.udt_name === 'int4') typeName = 'INTEGER';
      else if (col.udt_name === 'int8') typeName = 'BIGINT';

      let line = `  ${col.column_name} ${typeName}`;
      if (pkColumns.includes(col.column_name)) line += ' PRIMARY KEY';
      if (col.column_default) line += ` DEFAULT ${col.column_default}`;
      if (col.is_nullable === 'NO' && !pkColumns.includes(col.column_name)) line += ' NOT NULL';
      if (uniqRes.rows.find(u => u.attname === col.column_name)) line += ' UNIQUE';
      colDefs.push(line);
    }

    // Add check constraints inline
    for (const chk of checkRes.rows) {
      colDefs.push(`  CONSTRAINT ${chk.conname} ${chk.def}`);
    }

    // Add foreign keys
    for (const fk of fkRes.rows) {
      let fkDef = `  CONSTRAINT ${fk.constraint_name} FOREIGN KEY (${fk.column_name}) REFERENCES ${fk.foreign_table_name}(${fk.foreign_column_name})`;
      if (fk.delete_rule && fk.delete_rule !== 'NO ACTION') fkDef += ` ON DELETE ${fk.delete_rule}`;
      colDefs.push(fkDef);
    }

    ddl += colDefs.join(',\n');
    ddl += '\n);\n\n';
  }

  // Indexes
  ddl += `-- ========================================\n`;
  ddl += `-- Indexes\n`;
  ddl += `-- ========================================\n`;
  const idxRes = await client.query(`
    SELECT indexdef FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND indexname NOT LIKE '%_pkey'
    AND indexname NOT LIKE '%_key'
    ORDER BY tablename, indexname;
  `);
  for (const row of idxRes.rows) {
    ddl += `${row.indexdef};\n`;
  }
  ddl += '\n';

  // Functions
  ddl += `-- ========================================\n`;
  ddl += `-- Functions\n`;
  ddl += `-- ========================================\n`;
  const funcRes = await client.query(`
    SELECT pg_get_functiondef(p.oid) as funcdef
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public';
  `);
  for (const row of funcRes.rows) {
    ddl += `${row.funcdef};\n\n`;
  }

  // Triggers
  ddl += `-- ========================================\n`;
  ddl += `-- Triggers\n`;
  ddl += `-- ========================================\n`;
  const trigRes = await client.query(`
    SELECT pg_get_triggerdef(t.oid) as trigdef
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  `);
  for (const row of trigRes.rows) {
    ddl += `${row.trigdef};\n`;
  }

  fs.writeFileSync(path.join(BACKUP_DIR, 'schema.sql'), ddl, 'utf8');
  console.log('   ✅ schema.sql written');
}

// ─── 2. Export Data ─────────────────────────────────────────────────

async function exportData(client) {
  console.log('\n📦 Exporting table data...');
  const dataDir = path.join(BACKUP_DIR, 'data');
  ensureDir(dataDir);

  let fullInsertSQL = '';
  fullInsertSQL += '-- LeadFlow Full Data Export\n';
  fullInsertSQL += `-- Generated: ${new Date().toISOString()}\n`;
  fullInsertSQL += '-- Insert order respects foreign key dependencies\n\n';
  fullInsertSQL += '-- Disable triggers during import for clean data loading\n';
  fullInsertSQL += 'SET session_replication_role = replica;\n\n';

  const summary = {};

  for (const table of TABLES_IN_ORDER) {
    // Check if table has created_at column for ordering
    const colCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'created_at';
    `, [table]);
    const orderClause = colCheck.rows.length > 0 ? ' ORDER BY created_at ASC' : '';
    const res = await client.query(`SELECT * FROM ${table}${orderClause};`);
    const rows = res.rows;
    summary[table] = rows.length;

    // JSON export
    fs.writeFileSync(
      path.join(dataDir, `${table}.json`),
      JSON.stringify(rows, null, 2),
      'utf8'
    );

    // SQL INSERT export
    fullInsertSQL += `-- ========================================\n`;
    fullInsertSQL += `-- ${table} (${rows.length} rows)\n`;
    fullInsertSQL += `-- ========================================\n`;

    if (rows.length > 0) {
      const columns = Object.keys(rows[0]);
      for (const row of rows) {
        const values = columns.map(col => escapeSQL(row[col]));
        fullInsertSQL += `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
      }
    }
    fullInsertSQL += '\n';
    console.log(`   ✅ ${table}: ${rows.length} rows exported`);
  }

  fullInsertSQL += '-- Re-enable triggers\n';
  fullInsertSQL += 'SET session_replication_role = DEFAULT;\n';

  fs.writeFileSync(path.join(BACKUP_DIR, 'data_inserts.sql'), fullInsertSQL, 'utf8');
  fs.writeFileSync(path.join(dataDir, '_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('   ✅ data_inserts.sql written');

  return summary;
}

// ─── 3. Export Relationships & Constraints ──────────────────────────

async function exportRelationships(client) {
  console.log('\n🔗 Exporting relationships & constraints...');

  // Foreign keys
  const fkRes = await client.query(`
    SELECT
      tc.table_name AS source_table,
      kcu.column_name AS source_column,
      ccu.table_name AS target_table,
      ccu.column_name AS target_column,
      tc.constraint_name,
      rc.delete_rule,
      rc.update_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints AS rc ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name;
  `);

  // All constraints
  const allConstraints = await client.query(`
    SELECT
      tc.table_name,
      tc.constraint_name,
      tc.constraint_type,
      pg_get_constraintdef(pgc.oid) as definition
    FROM information_schema.table_constraints tc
    JOIN pg_constraint pgc ON pgc.conname = tc.constraint_name
    WHERE tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_type;
  `);

  // Indexes
  const indexes = await client.query(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname;
  `);

  // Column details for all tables
  const allColumns = {};
  for (const table of TABLES_IN_ORDER) {
    const colRes = await client.query(`
      SELECT column_name, data_type, character_maximum_length, 
             column_default, is_nullable, udt_name,
             numeric_precision, numeric_scale, ordinal_position
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position;
    `, [table]);
    allColumns[table] = colRes.rows;
  }

  const relationships = {
    generated_at: new Date().toISOString(),
    foreign_keys: fkRes.rows,
    all_constraints: allConstraints.rows,
    indexes: indexes.rows,
    column_details: allColumns
  };

  fs.writeFileSync(
    path.join(BACKUP_DIR, 'relationships.json'),
    JSON.stringify(relationships, null, 2),
    'utf8'
  );
  console.log('   ✅ relationships.json written');

  return relationships;
}

// ─── 4. Generate Restore Script ─────────────────────────────────────

function generateRestoreScript() {
  console.log('\n📜 Generating restore script...');

  const restoreSQL = `-- =============================================
-- LeadFlow Database FULL Restore Script
-- Generated: ${new Date().toISOString()}
-- =============================================
-- 
-- HOW TO USE:
-- 1. Create a new Neon database
-- 2. Get the new DATABASE_URL connection string
-- 3. Run this file against the new database:
--      psql "your-new-neon-connection-string" -f restore.sql
--
-- This script will:
--   a) Create all extensions
--   b) Create all tables with constraints
--   c) Insert all data (with triggers disabled)
--   d) Re-create indexes, functions, and triggers
-- =============================================

-- Step 1: Read and execute schema.sql first
-- \\i schema.sql

-- Step 2: Read and execute data_inserts.sql
-- \\i data_inserts.sql

-- Or run them separately:
--   psql "connection-string" -f schema.sql
--   psql "connection-string" -f data_inserts.sql

-- ALTERNATIVE: Use the Node.js restore script:
--   1. Update .env with the NEW database URL
--   2. node backup21may/restore.js
`;

  fs.writeFileSync(path.join(BACKUP_DIR, 'restore_instructions.sql'), restoreSQL, 'utf8');

  // Node.js restore script
  const restoreJS = `/**
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
    console.log('\\n📐 Creating schema...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    console.log('   ✅ Schema created');

    // Step 2: Insert data
    console.log('\\n📦 Inserting data...');
    const dataSql = fs.readFileSync(path.join(__dirname, 'data_inserts.sql'), 'utf8');
    await client.query(dataSql);
    console.log('   ✅ Data inserted');

    // Step 3: Verify
    console.log('\\n🔍 Verifying...');
    const tables = ${JSON.stringify(TABLES_IN_ORDER)};
    for (const table of tables) {
      const res = await client.query(\`SELECT COUNT(*) FROM \${table}\`);
      console.log(\`   \${table}: \${res.rows[0].count} rows\`);
    }

    console.log('\\n✅ Restore complete!');
  } catch (err) {
    console.error('❌ Restore failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

restore();
`;

  fs.writeFileSync(path.join(BACKUP_DIR, 'restore.js'), restoreJS, 'utf8');
  console.log('   ✅ restore_instructions.sql written');
  console.log('   ✅ restore.js written');
}

// ─── 5. Generate Summary Report ─────────────────────────────────────

function generateReport(dataSummary, relationships) {
  console.log('\n📊 Generating summary report...');

  let report = `# LeadFlow Database Backup Report\n`;
  report += `**Date:** ${new Date().toISOString()}\n`;
  report += `**Source:** Neon PostgreSQL (ap-southeast-1)\n\n`;

  report += `## Tables & Row Counts\n\n`;
  report += `| Table | Rows |\n|-------|------|\n`;
  for (const [table, count] of Object.entries(dataSummary)) {
    report += `| ${table} | ${count} |\n`;
  }
  const totalRows = Object.values(dataSummary).reduce((a, b) => a + b, 0);
  report += `| **TOTAL** | **${totalRows}** |\n\n`;

  report += `## Foreign Key Relationships\n\n`;
  report += `| Source Table | Column | → Target Table | Column | On Delete |\n`;
  report += `|-------------|--------|----------------|--------|----------|\n`;
  for (const fk of relationships.foreign_keys) {
    report += `| ${fk.source_table} | ${fk.source_column} | ${fk.target_table} | ${fk.target_column} | ${fk.delete_rule} |\n`;
  }

  report += `\n## Files in this Backup\n\n`;
  report += `| File | Description |\n|------|-------------|\n`;
  report += `| schema.sql | Full DDL (tables, indexes, functions, triggers) |\n`;
  report += `| data_inserts.sql | All data as INSERT statements |\n`;
  report += `| data/*.json | Each table's data as JSON |\n`;
  report += `| relationships.json | FK, constraints, indexes, column metadata |\n`;
  report += `| restore.js | Node.js script to restore to a new DB |\n`;
  report += `| restore_instructions.sql | Instructions for psql restore |\n`;
  report += `| REPORT.md | This summary report |\n`;

  report += `\n## How to Restore\n\n`;
  report += `### Option A: Using Node.js restore script\n`;
  report += `\`\`\`bash\n`;
  report += `# Add NEW_DATABASE_URL to your .env file\n`;
  report += `# NEW_DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require"\n`;
  report += `node backup21may/restore.js\n`;
  report += `\`\`\`\n\n`;
  report += `### Option B: Using psql directly\n`;
  report += `\`\`\`bash\n`;
  report += `psql "your-new-neon-url" -f backup21may/schema.sql\n`;
  report += `psql "your-new-neon-url" -f backup21may/data_inserts.sql\n`;
  report += `\`\`\`\n`;

  fs.writeFileSync(path.join(BACKUP_DIR, 'REPORT.md'), report, 'utf8');
  console.log('   ✅ REPORT.md written');
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  LeadFlow Neon DB Full Export');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════');
  console.log(`\n🗄️  Connecting to Neon DB...`);
  console.log(`   Host: ${DATABASE_URL.match(/@([^/]+)/)?.[1] || 'unknown'}`);

  const client = await pool.connect();

  try {
    // Verify connection
    const verifyRes = await client.query('SELECT current_database(), current_user, version()');
    console.log(`   Database: ${verifyRes.rows[0].current_database}`);
    console.log(`   User: ${verifyRes.rows[0].current_user}`);
    console.log('   ✅ Connected!\n');

    // Discover any extra tables not in our list
    const tableRes = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const dbTables = tableRes.rows.map(r => r.table_name);
    const extraTables = dbTables.filter(t => !TABLES_IN_ORDER.includes(t));
    if (extraTables.length > 0) {
      console.log(`   ⚠️  Found extra tables not in known list: ${extraTables.join(', ')}`);
      // Add them to the end
      TABLES_IN_ORDER.push(...extraTables);
    }
    console.log(`   Tables to export: ${TABLES_IN_ORDER.join(', ')}`);

    ensureDir(BACKUP_DIR);

    await exportSchema(client);
    const dataSummary = await exportData(client);
    const relationships = await exportRelationships(client);
    generateRestoreScript();
    generateReport(dataSummary, relationships);

    console.log('\n═══════════════════════════════════════════');
    console.log('  ✅ BACKUP COMPLETE!');
    console.log(`  Location: ${BACKUP_DIR}`);
    console.log('═══════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n❌ Export failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
