@echo off
title Quotation Manager
color 1F

echo =====================================================================
echo           QUOTATION MANAGER PWA
echo                 Portable Local Server Launcher
echo =====================================================================
echo.

cd /d "%~dp0"

set PORT=8000

:: Step 1: Open default browser to localhost
echo [1/3] Preparing application at http://localhost:%PORT% ...
start "" "http://localhost:%PORT%"

:: Step 2: Try starting server via Python (if available)
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [2/3] Detected Python. Starting local server on port %PORT%...
    echo [3/3] Application running! Keep this window open while using the app.
    echo.
    echo Press Ctrl+C to stop the server when finished.
    echo ---------------------------------------------------------------------
    python -m http.server %PORT%
    goto END
)

where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [2/3] Detected Python Launcher (py). Starting local server on port %PORT%...
    echo [3/3] Application running! Keep this window open while using the app.
    echo.
    echo Press Ctrl+C to stop the server when finished.
    echo ---------------------------------------------------------------------
    py -m http.server %PORT%
    goto END
)

:: Step 3: Try starting server via Node.js / npx (if available)
where npx >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [2/3] Detected Node.js (npx). Starting local server on port %PORT%...
    echo [3/3] Application running! Keep this window open while using the app.
    echo.
    echo Press Ctrl+C to stop the server when finished.
    echo ---------------------------------------------------------------------
    call npx --yes serve -l %PORT% -s .
    goto END
)

:: Step 4: Zero-Dependency Fallback: Built-in Windows PowerShell Web Server
echo [2/3] Python/Node not detected. Using Windows built-in PowerShell server...
echo [3/3] Application running! Keep this window open while using the app.
echo.
echo Press Ctrl+C to stop the server when finished.
echo ---------------------------------------------------------------------

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$port = %PORT%;" ^
    "$listener = New-Object System.Net.HttpListener;" ^
    "$listener.Prefixes.Add(\"http://localhost:$port/\");" ^
    "try { $listener.Start(); } catch { Write-Host \"Port $port is busy or access denied. Trying port 8080...\"; $port=8080; $listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add(\"http://localhost:$port/\"); $listener.Start(); Start-Process \"http://localhost:$port\"; }" ^
    "Write-Host \"Quotation Manager server active on http://localhost:$port/\";" ^
    "$baseDir = Get-Location;" ^
    "$mimeTypes = @{ '.html'='text/html; charset=utf-8'; '.js'='application/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json; charset=utf-8'; '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.pdf'='application/pdf'; '.ico'='image/x-icon'; '.csv'='text/csv; charset=utf-8' };" ^
    "while ($listener.IsListening) {" ^
    "  $context = $listener.GetContext();" ^
    "  $reqPath = $context.Request.Url.LocalPath.TrimStart('/');" ^
    "  if ([string]::IsNullOrEmpty($reqPath)) { $reqPath = 'index.html'; }" ^
    "  $filePath = Join-Path $baseDir $reqPath;" ^
    "  if (Test-Path $filePath -PathType Leaf) {" ^
    "    $ext = [System.IO.Path]::GetExtension($filePath).ToLower();" ^
    "    $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' };" ^
    "    $context.Response.ContentType = $contentType;" ^
    "    $context.Response.AddHeader('Cache-Control', 'no-cache');" ^
    "    $bytes = [System.IO.File]::ReadAllBytes($filePath);" ^
    "    $context.Response.ContentLength64 = $bytes.Length;" ^
    "    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length);" ^
    "  } else {" ^
    "    $context.Response.StatusCode = 404;" ^
    "  }" ^
    "  $context.Response.OutputStream.Close();" ^
    "}"

:END
pause
