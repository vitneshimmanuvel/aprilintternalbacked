-- =============================================
-- LeadFlow Database FULL Restore Script
-- Generated: 2026-05-21T13:03:03.211Z
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
-- \i schema.sql

-- Step 2: Read and execute data_inserts.sql
-- \i data_inserts.sql

-- Or run them separately:
--   psql "connection-string" -f schema.sql
--   psql "connection-string" -f data_inserts.sql

-- ALTERNATIVE: Use the Node.js restore script:
--   1. Update .env with the NEW database URL
--   2. node backup21may/restore.js
