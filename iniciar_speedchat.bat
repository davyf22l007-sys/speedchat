@echo off
setlocal enabledelayedexpansion
title SpeedChat
cd /d "%~dp0"

:restart
cls
echo ================================
echo   SpeedChat - Iniciando...
echo   Banco SQLite local (D:speedchat_data)
echo   Nunca mais reseta!
echo ================================
echo.

REM Verificar Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    cls
    echo ================================
    echo   [ERRO] Node.js NAO ENCONTRADO
    echo ================================
    echo.
    echo Baixe em: https://nodejs.org
    echo.
    pause
    exit /b
)

echo [OK] Node.js encontrado

if not exist "node_modules\" (
    echo.
    echo Instalando dependencias...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar dependencias
        pause
        exit /b
    )
    echo [OK] Dependencias instaladas
)

set PORT=3456
set ADMIN_USER=davyf22l
set ADMIN_PASS=@Davyf22l5820

REM Matar processos antigos na porta
echo.
echo Limpando porta %PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

REM Verifica se o SQLite ja foi migrado
if not exist "D:\speedchat_data\speedchat.db" (
    if exist "data\db.json" (
        echo.
        echo Primeira execucao - migrando dados para SQLite...
        node migrar_sqlite.js
    )
)

REM Iniciar servidor
echo.
echo Iniciando servidor com SQLite...
set SERVER_LOG=%~dp0server_log.txt
echo [%date% %time%] Servidor iniciando... > "%SERVER_LOG%"
start /B node src/server.js >> "%SERVER_LOG%" 2>&1

echo Aguardando servidor iniciar...
set /a count=0
:waitloop
timeout /t 2 /nobreak >nul
set /a count+=1

curl -s http://localhost:%PORT% >nul 2>&1
if %errorlevel% equ 0 goto :server_ok

if %count% geq 15 (
    cls
    echo ================================
    echo   [ERRO] Servidor nao iniciou
    echo ================================
    echo.
    echo Verifique o arquivo server_log.txt
    echo.
    pause
    exit /b
)
goto :waitloop

:server_ok
echo [OK] Servidor rodando com SQLite!
echo.

REM Ngrok
echo Iniciando Ngrok...
taskkill /im ngrok.exe /f >nul 2>&1
timeout /t 1 /nobreak >nul

set NGROK_LOG=%~dp0ngrok_log.txt
echo [%date% %time%] Ngrok iniciando... > "%NGROK_LOG%"
start /B ngrok http %PORT% --url=revolt-designer-dilation.ngrok-free.dev >> "%NGROK_LOG%" 2>&1

echo [OK] Ngrok rodando!
echo.
echo ================================
echo   SpeedChat pronto!
echo   Local:  http://localhost:%PORT%
echo   Publico: https://revolt-designer-dilation.ngrok-free.dev
echo   Banco:  D:\speedchat_data\speedchat.db
echo   Dados persistentes - nunca mais resetam!
echo ================================
echo.

if not defined BROWSER_OPENED (
    set BROWSER_OPENED=1
    start http://localhost:%PORT%
)
echo.
echo Monitoramento ativo - reinicia automaticamente se cair
echo Feche esta janela para desligar
echo.

:watchdog
timeout /t 10 /nobreak >nul

curl -s http://localhost:%PORT% >nul 2>&1
if %errorlevel% equ 0 goto :watchdog

echo [%date% %time%] Servidor caiu! Reiniciando... >> "%SERVER_LOG%"
echo [AVISO] Servidor caiu! Reiniciando em 3 segundos...
timeout /t 3 /nobreak >nul
goto :restart
