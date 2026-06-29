@echo off
chcp 65001 >nul
title Cowork LLM local
cd /d "%~dp0"

echo ============================================
echo    COWORK LLM - iniciando seu cowork local
echo ============================================
echo.

REM --- Node instalado? ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo Instale em https://nodejs.org e tente de novo.
  echo.
  pause
  exit /b 1
)

REM --- Dependencias instaladas? ---
if not exist "node_modules" (
  echo Primeira execucao: instalando dependencias...
  call npm install
  echo.
)

REM --- Abre o navegador depois de 3s (servidor ja no ar) ---
start "" /b cmd /c "timeout /t 3 >nul & start http://localhost:3344"

echo Servidor subindo em http://localhost:3344
echo O navegador abre sozinho em alguns segundos.
echo.
echo Para ENCERRAR: feche esta janela ou pressione Ctrl+C.
echo ============================================
echo.

REM --- Sobe o servidor (segura a janela aberta) ---
node server.js

echo.
echo Servidor encerrado.
pause
