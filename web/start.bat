@echo off
title AnXiang - Community Alert Console (Python 3 + SQLite)
cd /d "%~dp0"
echo Starting AnXiang local server (Python 3 + SQLite)...
echo.

python --version >nul 2>nul
if not errorlevel 1 (
  python "%~dp0server.py"
  if not errorlevel 1 goto END
  echo Python server stopped unexpectedly. Trying the py launcher...
  echo.
)

py -3 --version >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0server.py"
  if not errorlevel 1 goto END
)

echo.
echo Could not start the server. Python 3 is required for the SQLite backend.
echo Install Python from:
echo   https://www.python.org/downloads/
echo Then double-click this file again.
echo.
echo (serve.py / serve.js are kept as static-only fallbacks without the API.)
echo.
pause

:END
