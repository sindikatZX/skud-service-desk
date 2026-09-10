@echo off
setlocal EnableExtensions
title СКУД-Сервис

rem ---------------------------------------------------------------
rem  Запуск приложения "СКУД-Сервис" на этом компьютере.
rem  Двойной клик - приложение при необходимости соберётся, поднимется
rem  и откроется в браузере. Окно не закрывать: пока оно открыто,
rem  приложение работает. Остановка - Ctrl+C или закрыть окно.
rem
rem  Параметры (необязательно):
rem    start-app.bat rebuild  - пересобрать приложение перед стартом
rem    start-app.bat dev      - режим разработки (пересборка на лету)
rem ---------------------------------------------------------------

set "APP_DIR=C:\Users\reality\projects\desk\app2"
set "PORT=3003"
set "PGSERVICE=postgresql-x64-16"
set "URL=http://localhost:%PORT%"

echo.
echo   СКУД-Сервис
echo   ---------------------------------------------
echo   Папка:  %APP_DIR%
echo   Адрес:  %URL%
echo.

if not exist "%APP_DIR%\package.json" (
  echo   [!] Не найдена папка приложения: %APP_DIR%
  echo       Поправьте строку APP_DIR в начале этого файла.
  goto :halt
)
cd /d "%APP_DIR%"

rem --- Уже запущено? Тогда просто открываем браузер ---
netstat -ano | findstr /r /c:"TCP.*:%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo   Приложение уже работает на порту %PORT% - открываю браузер.
  start "" "%URL%"
  timeout /t 3 >nul
  goto :eof
)

rem --- База данных ---
sc query "%PGSERVICE%" | findstr /i "RUNNING" >nul 2>&1
if errorlevel 1 (
  echo   PostgreSQL не запущен - пробую запустить службу %PGSERVICE%...
  net start "%PGSERVICE%" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo   [!] Не удалось запустить PostgreSQL.
    echo       Запустите этот файл от имени администратора либо стартуйте
    echo       службу вручную: net start %PGSERVICE%
    echo.
    goto :halt
  )
  echo   PostgreSQL запущен.
)

rem --- Зависимости ---
if not exist "node_modules" (
  echo   Первый запуск: устанавливаю зависимости, это займёт пару минут...
  call npm install || goto :npmfail
)

rem --- Режим разработки ---
if /i "%~1"=="dev" (
  echo   Режим разработки. Браузер откроется через несколько секунд.
  start "" cmd /c "timeout /t 8 >nul & start """" ""%URL%"""
  call npm run dev -- -p %PORT% -H 0.0.0.0
  goto :halt
)

rem --- Сборка ---
if /i "%~1"=="rebuild" (
  echo   Пересобираю приложение...
  call npm run build || goto :buildfail
) else if not exist ".next\BUILD_ID" (
  echo   Сборки нет - собираю приложение, это займёт минуту...
  call npm run build || goto :buildfail
)

rem --- Запуск ---
echo.
echo   Запускаю. Браузер откроется автоматически.
echo   С телефона в этой же сети адрес смотрите ниже в строке Network.
echo   Остановить: Ctrl+C или закройте это окно.
echo.
start "" cmd /c "timeout /t 5 >nul & start """" ""%URL%"""
call npx next start -p %PORT% -H 0.0.0.0
goto :halt

:npmfail
echo.
echo   [!] Не удалось установить зависимости. Проверьте, что установлен Node.js:
echo       node --version
goto :halt

:buildfail
echo.
echo   [!] Сборка завершилась с ошибкой - смотрите текст выше.
goto :halt

:halt
echo.
pause
