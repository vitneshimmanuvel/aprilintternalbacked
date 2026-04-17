@echo off
echo ====================================
echo   LeadFlow DB Restore to New Server
echo ====================================
echo.
echo USAGE: restore-db.bat [NEW_DATABASE_URL] [BACKUP_FILE.sql]
echo.
echo Example:
echo   restore-db.bat "postgresql://user:pass@host/dbname" leadflow_backup.sql
echo.

set NEW_DB_URL=%1
set BACKUP_FILE=%2

if "%NEW_DB_URL%"=="" (
  echo ERROR: Please provide the new database URL as argument 1
  pause
  exit /b 1
)

if "%BACKUP_FILE%"=="" (
  echo ERROR: Please provide the backup .sql file as argument 2
  pause
  exit /b 1
)

echo Restoring from: %BACKUP_FILE%
echo To DB: %NEW_DB_URL%
echo.

psql "%NEW_DB_URL%" -f "%BACKUP_FILE%"

echo.
echo ====================================
echo   DONE! Database restored!
echo   Update your .env DATABASE_URL now
echo ====================================
pause
