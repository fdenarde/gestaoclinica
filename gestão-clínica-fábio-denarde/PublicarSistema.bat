@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ════════════════════════════════════════════════════════════════
echo   PUBLICACAO SEGURA DO SISTEMA
echo   Gestao Clinica — Fabio Denarde
echo ════════════════════════════════════════════════════════════════
echo.
echo   Link principal (Vercel): https://gestaoclinica-solucoes.vercel.app/
echo   Link reserva  (GitHub): https://fdenarde.github.io/gestaoclinica/
echo.
echo   Iniciando processo de publicacao segura...
echo   Nao feche esta janela ate o final.
echo.

node safe-deploy.cjs
pause
