@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Kroniky Popola - server

rem Python z Microsoft Store je len zastupca (vypise "Python sa nenasiel"), preto ho najprv overime.
python -c "import http.server" >nul 2>nul
if %errorlevel%==0 (
  python serve.py 8080
  goto :end
)
if exist "C:\msys64\ucrt64\bin\python.exe" (
  "C:\msys64\ucrt64\bin\python.exe" -c "import http.server" >nul 2>nul
  if not errorlevel 1 (
    "C:\msys64\ucrt64\bin\python.exe" serve.py 8080
    goto :end
  )
)
echo Python nenajdeny - spustam PowerShell server...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8080

:end
echo.
echo Server sa ukoncil. Ak nastala chyba, je vypisana vyssie.
pause
