@echo off
echo ====================================
echo   LeadFlow DB Backup from Neon
echo ====================================

set PGPASSWORD=npg_h5PoEVOK9yRw
set DUMP_FILE=leadflow_backup_%DATE:~-4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%.sql

echo Dumping database to: %DUMP_FILE%

pg_dump "postgresql://neondb_owner:npg_h5PoEVOK9yRw@ep-plain-truth-a1i8o7qh-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require" ^
  --no-owner ^
  --no-acl ^
  --clean ^
  --if-exists ^
  -f %DUMP_FILE%

echo.
echo ====================================
echo   DONE! Backup saved: %DUMP_FILE%
echo   Move this file to your new server
echo ====================================
pause
