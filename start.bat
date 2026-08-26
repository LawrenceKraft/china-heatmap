@echo off
chcp 65001 >nul
title 中国数据热力地图
cd /d "%~dp0"

echo ==========================================
echo   中国数据热力地图 - 本地启动脚本
echo ==========================================
echo.

set PORT=8080

REM 检查 Python 是否可用
where python >nul 2>nul
if %errorlevel%==0 (
  echo [启动] 使用 Python 启动本地服务器 ^(端口 %PORT%^)...
  start "ChinaMapServer" python -m http.server %PORT%
  call :open_browser
  goto :eof
)

REM 检查 Python3 是否可用
where python3 >nul 2>nul
if %errorlevel%==0 (
  echo [启动] 使用 Python3 启动本地服务器 ^(端口 %PORT%^)...
  start "ChinaMapServer" python3 -m http.server %PORT%
  call :open_browser
  goto :eof
)

REM 检查 Node.js 是否可用（作为备用方案）
where node >nul 2>nul
if %errorlevel%==0 (
  echo [启动] 未找到 Python，改用 Node 启动本地服务器 ^(端口 %PORT%^)...
  start "ChinaMapServer" cmd /c "npx --yes serve -l %PORT% ."
  call :open_browser
  goto :eof
)

echo [错误] 未检测到 Python 或 Node.js，无法启动服务器。
echo 请先安装 Python 3（https://www.python.org/downloads/）后重试。
pause
goto :eof

:open_browser
REM 等待服务器就绪后再打开浏览器，避免连接失败
echo [启动] 等待服务器就绪...
set /a tries=0
:wait_loop
set /a tries+=1
if %tries% gtr 20 (
  echo [警告] 服务器启动超时，仍尝试打开浏览器...
  start "" "http://localhost:%PORT%/"
  goto :eof
)
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%PORT%/' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 (
  echo [启动] 服务器已就绪，正在打开浏览器...
  start "" "http://localhost:%PORT%/"
  goto :eof
)
goto :wait_loop
