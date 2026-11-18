@echo off
title Community For Goats - Auto-Update Bot

:: Garante que o terminal abre na pasta exata do bot (essencial para o arranque do Windows)
cd /d "%~dp0"

:: Garante que o Windows encontra o Node.js e o Ollama em D:\Ollama
set "PATH=%PATH%;C:\Program Files\nodejs;D:\Ollama"

echo [0/4] A aguardar conexao de rede ao iniciar o Windows (5 segundos)...
timeout /t 5 /nobreak >nul

echo [1/4] A atualizar o IP local e o .env automaticamente...
node ip.js

echo [2/4] A iniciar o Ollama em segundo plano...
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I /N "ollama.exe" >NUL
if "%errorlevel%"=="0" (
    echo [OK] Ollama ja esta em execucao.
) else if exist "D:\Ollama\ollama.exe" (
    start /B "" "D:\Ollama\ollama.exe" serve >nul 2>&1
    echo [OK] Servidor do Ollama iniciado a partir de D:\Ollama.
) else (
    echo [AVISO] Executavel do Ollama nao encontrado em D:\Ollama, a continuar arranque do bot...
)

echo [3/4] A aguardar a estabilizacao do motor de IA (3 segundos)...
timeout /t 3 /nobreak >nul

:LOOP
echo.
echo [4/4] A arrancar o supervisor do Discord...
echo =====================================================================
echo   MODO ATIVO: bot, painel externo, API, webhook e atualizacoes Git
echo =====================================================================
echo.

:: Supervisor cria o tunel Cloudflare, inicia o bot e verifica atualizacoes
npm.cmd start

echo.
echo [AVISO] O supervisor foi encerrado. A relancar em 3 segundos...
timeout /t 3 /nobreak >nul
goto LOOP