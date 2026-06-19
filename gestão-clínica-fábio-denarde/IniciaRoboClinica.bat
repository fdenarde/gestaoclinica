@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo INICIALIZACAO BLOQUEADA POR SEGURANCA.
echo Este arquivo nao inicia mais o WhatsApp diretamente.
echo Consulte docs\PM2_ROBO_CLINICA.md para o procedimento futuro autorizado.
echo.
exit /b 1
