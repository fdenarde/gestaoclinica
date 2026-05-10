@echo off
chcp 65001 >nul
timeout /t 20 /nobreak
cd /d "d:\Backup Projeto Clinica completo\gestão-clínica-fábio-denarde"
call npm run server
pause