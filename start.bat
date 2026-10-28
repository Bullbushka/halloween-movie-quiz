@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Ніч кіношного жаху - сервер гри

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist "node_modules\socket.io\package.json" goto run
echo.
echo   Перший запуск: встановлюю потрібні файли, це займе хвилину...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto npmfail

:run
node server.js --open
if errorlevel 1 goto crashed
exit /b 0

:crashed
echo.
echo   Сервер зупинився через помилку. Прочитайте повідомлення вище.
echo.
pause
exit /b 1

:nonode
echo.
echo   Не знайдено Node.js.
echo.
echo   1. Відкрийте https://nodejs.org і завантажте версію LTS.
echo   2. Встановіть її, усюди натискаючи "Next".
echo   3. Знову двічі клацніть start.bat.
echo.
start "" "https://nodejs.org/"
pause
exit /b 1

:npmfail
echo.
echo   Не вдалося встановити потрібні файли.
echo   Перевірте інтернет і запустіть start.bat ще раз.
echo.
pause
exit /b 1
