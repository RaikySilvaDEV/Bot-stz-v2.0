@echo off
title Community For Goats - Auto-Update Bot

:: Garante que o terminal abre na pasta exata do bot
cd /d "%~dp0"

:: Garante que o Windows encontra Node.js, Ollama e Cloudflare Tunnel
set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\Ollama;C:\Program Files (x86)\cloudflared"

echo [0/4] A aguardar conexao de rede ao iniciar o Windows (5 segundos)...
timeout /t 5 /nobreak >nul

echo [1/4] A atualizar o IP local e o .env automaticamente...
node ip.js
if errorlevel 1 echo [AVISO] Nao foi possivel atualizar o endereco local no .env.

echo [2/4] A iniciar o Ollama em segundo plano...
set "OLLAMA_EXE="
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not defined OLLAMA_EXE if exist "D:\Ollama\ollama.exe" set "OLLAMA_EXE=D:\Ollama\ollama.exe"
if not defined OLLAMA_EXE (
    for /f "delims=" %%I in ('where ollama.exe 2^>nul') do if not defined OLLAMA_EXE set "OLLAMA_EXE=%%I"
)

if defined OLLAMA_EXE (
    tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I "ollama.exe" >NUL
    if errorlevel 1 (
        start /B "" "%OLLAMA_EXE%" serve >nul 2>&1
        echo [OK] Servidor do Ollama iniciado.
    ) else (
        echo [OK] Ollama ja esta em execucao.
    )
) else (
    echo [AVISO] Executavel do Ollama nao encontrado; a continuar arranque do bot...
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

:: O supervisor inicia o bot, o tunel Cloudflare e as atualizacoes automaticas.
call npm start

echo.
echo [AVISO] O processo foi encerrado. A relancar em 3 segundos...
timeout /t 3 /nobreak >nul
goto LOOP