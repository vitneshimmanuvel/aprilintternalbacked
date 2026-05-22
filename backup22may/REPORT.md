# LeadFlow Database Backup Report
**Date:** 2026-05-22T12:04:12.611Z
**Source:** Neon PostgreSQL (ap-southeast-1)

## Tables & Row Counts

| Table | Rows |
|-------|------|
| users | 7 |
| leads | 290 |
| lead_history | 661 |
| lead_notes | 346 |
| note_edits | 9 |
| reminders | 22 |
| board_users | 9 |
| boards | 3 |
| lead_visits | 0 |
| settings | 4 |
| visit_participants | 0 |
| **TOTAL** | **1351** |

## Foreign Key Relationships

| Source Table | Column | → Target Table | Column | On Delete |
|-------------|--------|----------------|--------|----------|
| board_users | user_id | users | id | CASCADE |
| board_users | board_id | boards | id | CASCADE |
| boards | created_by | users | id | SET NULL |
| lead_history | user_id | users | id | RESTRICT |
| lead_history | lead_id | leads | id | CASCADE |
| lead_notes | user_id | users | id | RESTRICT |
| lead_notes | lead_id | leads | id | CASCADE |
| lead_visits | lead_id | leads | id | CASCADE |
| lead_visits | created_by | users | id | RESTRICT |
| leads | assigned_to | users | id | SET NULL |
| leads | board_id | boards | id | SET NULL |
| leads | created_by | users | id | RESTRICT |
| note_edits | user_id | users | id | RESTRICT |
| note_edits | note_id | lead_notes | id | CASCADE |
| reminders | user_id | users | id | RESTRICT |
| reminders | lead_id | leads | id | CASCADE |
| settings | board_id | boards | id | CASCADE |
| visit_participants | user_id | users | id | RESTRICT |
| visit_participants | visit_id | lead_visits | id | CASCADE |

## Files in this Backup

| File | Description |
|------|-------------|
| schema.sql | Full DDL (tables, indexes, functions, triggers) |
| data_inserts.sql | All data as INSERT statements |
| data/*.json | Each table's data as JSON |
| relationships.json | FK, constraints, indexes, column metadata |
| restore.js | Node.js script to restore to a new DB |
| restore_instructions.sql | Instructions for psql restore |
| REPORT.md | This summary report |

## How to Restore

### Option A: Using Node.js restore script
```bash
# Add NEW_DATABASE_URL to your .env file
# NEW_DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require"
node backup21may/restore.js
```

### Option B: Using psql directly
```bash
psql "your-new-neon-url" -f backup21may/schema.sql
psql "your-new-neon-url" -f backup21may/data_inserts.sql
```
