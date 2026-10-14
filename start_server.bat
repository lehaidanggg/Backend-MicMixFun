@echo off
title Micmic Fun Studio Server
cd /d "%~dp0"
echo ========================================================
echo   Starting Micmic Fun Studio Server...
echo ========================================================
python server.py --open
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Python not found in PATH or failed to start.
    echo Trying python -m http.server 8080...
    python -m http.server 8080
)
pause
