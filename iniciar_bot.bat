@echo off
title Community For Goats - Auto-Update Bot

:: Garante que o terminal abre na pasta exata do bot
cd /d "%~dp0"

:: Garante que o Windows encontra o Node.js e o Ollama em D:\Ollama
set "PATH=%PATH%;C:\Program Files\nodejs;D:\Ollama"

echo [0/4] A aguardar conexao de rede ao iniciar o Windows (5 segundos)...
"%SystemRoot%\System32\timeout.exe" /t 5 /nobreak >nul

echo [1/4] A atualizar o IP local e o .env automaticamente...
node ip.js

echo [2/4] A iniciar o Ollama em segundo plano...
set "OLLAMA_EXE="
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not defined OLLAMA_EXE if exist "D:\Ollama\ollama.exe" set "OLLAMA_EXE=D:\Ollama\ollama.exe"
if not defined OLLAMA_EXE for /f "delims=" %%I in ('"%SystemRoot%\System32\where.exe" ollama.exe 2^>nul') do if not defined OLLAMA_EXE set "OLLAMA_EXE=%%I"
if not defined OLLAMA_EXE (
    echo [AVISO] Executavel do Ollama nao encontrado em D:\Ollama, a continuar arranque do bot...
) else (
    node -e "fetch('http://127.0.0.1:11434/api/tags').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))" >nul 2>&1
    if errorlevel 1 (
        start "" /B "%OLLAMA_EXE%" serve >nul 2>&1
        echo [OK] Servidor Ollama iniciado.
    ) else (
        echo [OK] Ollama ja esta respondendo.
    )
)

echo [3/4] A aguardar a estabilizacao do motor de IA (3 segundos)...
"%SystemRoot%\System32\timeout.exe" /t 3 /nobreak >nul
node -e "fetch('http://127.0.0.1:11434/api/tags').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))" >nul 2>&1
if errorlevel 1 (
    echo [AVISO] Ollama ainda nao respondeu em 127.0.0.1:11434; o bot continuara sem IA local.
) else (
    echo [OK] API do Ollama disponivel.
)

echo.
echo [4/4] A arrancar o supervisor do Discord e o tunel do painel...
echo =====================================================================
echo   MODO ATIVO: bot, painel externo, API, webhook e atualizacoes Git
echo =====================================================================
echo.

:: O supervisor inicia o tunel Cloudflare e reinicia o bot quando necessario.
call npm start

echo.
echo [AVISO] O supervisor foi encerrado.
pause