@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Кодування питань

where node >nul 2>nul
if errorlevel 1 (
  echo   Не знайдено Node.js. Встановіть його з https://nodejs.org
  pause
  exit /b 1
)
if not exist "questions.plain.json" (
  echo.
  echo   Не знайдено файл questions.plain.json поруч із цим файлом.
  echo.
  pause
  exit /b 1
)
node tools\encode.js questions.plain.json questions.json
echo.
pause
