@echo off
cd /d "%~dp0"

if not exist "node_modules" (
  echo 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 goto :failed
)

rem npm 11 默认拦截安装脚本，Electron 的二进制可能没被解开。这里自动补上。
if not exist "node_modules\electron\dist\electron.exe" (
  echo 正在准备 Electron 运行时...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$z = Join-Path $env:LOCALAPPDATA 'electron\Cache'; $f = Get-ChildItem $z -Filter 'electron-v33.2.0-win32-x64.zip' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($f) { New-Item -ItemType Directory -Force -Path 'node_modules\electron\dist' | Out-Null; Expand-Archive -LiteralPath $f.FullName -DestinationPath 'node_modules\electron\dist' -Force; Set-Content -LiteralPath 'node_modules\electron\path.txt' -Value 'electron.exe' -NoNewline; Write-Host 'Electron 已就绪' } else { Write-Host '本地缓存里没有 Electron 压缩包，尝试联网安装...' }"
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo 尝试用 npm 重新安装 Electron...
  call npm install electron@33.2.0 --no-save --no-fund --no-audit
  if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo 无法准备 Electron 运行时。请手动执行：
    echo   npm install
    echo   node node_modules\electron\install.js
    pause
    exit /b 1
  )
)

echo 正在启动 Wework...
call npm run app
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo 启动失败。请检查上面的错误信息。
pause
exit /b 1
