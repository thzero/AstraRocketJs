@echo off
rem Build the TeaVM engine and vendor it into the web app (double-clickable Windows wrapper).
rem Thin shim over build-engine.mjs; forwards any args (e.g. --no-copy).
cd /d "%~dp0"
node build-engine.mjs %*
