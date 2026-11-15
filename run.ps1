<#
.SYNOPSIS
    Serves the PYRA 3D simulation (demo/pyra-3d.html) on localhost and opens it in the browser.

.DESCRIPTION
    Uses Python's built-in http.server when Python is installed. Without Python it falls back to a
    small static file server written in PowerShell. Only the demo/ folder is served, and only on
    127.0.0.1. Press Ctrl+C to stop.

.PARAMETER Port
    Port to listen on. Default 8080.

.PARAMETER NoBrowser
    Start the server without opening a browser window.

.PARAMETER Test
    Run the flame model unit tests (node --test) first and stop if they fail.

.EXAMPLE
    .\run-simulation.ps1
.EXAMPLE
    .\run-simulation.ps1 -Port 9000 -Test
#>
[CmdletBinding()]
param(
    [int]$Port = 8080,
    [switch]$NoBrowser,
    [switch]$Test
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$demo = Join-Path $root 'demo'
$page = 'pyra-3d.html'
$url  = "http://127.0.0.1:$Port/$page"

if (-not (Test-Path (Join-Path $demo $page))) {
    Write-Error "Cannot find $page in $demo"
}

# ---------- optional: flame model tests ----------
if ($Test) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Error 'Node.js 18+ is needed for -Test (node --test).'
    }
    Write-Host 'Running flame model tests...' -ForegroundColor Cyan
    & node --test (Join-Path $root 'tests\flame_model.test.js')
    if ($LASTEXITCODE -ne 0) { Write-Error 'Tests failed, not starting the server.' }
}

function Test-Python {
    # The Microsoft Store "python" alias exists even when Python is not installed, so actually run it.
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) { return $false }
    try { & python -c "import http.server" 2>$null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

function Open-Browser {
    if (-not $NoBrowser) { Start-Process $url }
}

Write-Host "PYRA simulation: $url" -ForegroundColor Green
Write-Host 'Press Ctrl+C to stop.' -ForegroundColor DarkGray

# ---------- server option 1: Python ----------
if (Test-Python) {
    $server = Start-Process python -ArgumentList '-m', 'http.server', $Port, '--bind', '127.0.0.1', '--directory', "`"$demo`"" `
        -NoNewWindow -PassThru
    try {
        Start-Sleep -Milliseconds 800
        if ($server.HasExited) { Write-Error "Python server exited. Is port $Port already in use?" }
        Open-Browser
        Wait-Process -Id $server.Id
    }
    finally {
        if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    }
    return
}

# ---------- server option 2: PowerShell HttpListener ----------
$mime = @{
    '.html' = 'text/html; charset=utf-8'; '.js'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8';  '.json' = 'application/json'
    '.png'  = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
}
$demoFull = [System.IO.Path]::GetFullPath($demo).TrimEnd('\') + '\'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try { $listener.Start() } catch { Write-Error "Could not listen on port ${Port}: $($_.Exception.Message)" }

Write-Host 'Python not found, using the built-in PowerShell server.' -ForegroundColor DarkGray
Open-Browser
try {
    while ($listener.IsListening) {
        # Poll so Ctrl+C can interrupt between requests.
        $pending = $listener.GetContextAsync()
        while (-not $pending.AsyncWaitHandle.WaitOne(250)) { }
        $ctx = $pending.GetAwaiter().GetResult()
        $res = $ctx.Response
        try {
            $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
            if ($rel -eq '') { $rel = $page }
            $file = [System.IO.Path]::GetFullPath((Join-Path $demoFull $rel))
            # Refuse anything outside demo/ (path traversal) and anything that is not a file.
            if ($file.StartsWith($demoFull, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $file -PathType Leaf)) {
                $ext = [System.IO.Path]::GetExtension($file).ToLower()
                $type = $mime[$ext]
                if (-not $type) { $type = 'application/octet-stream' }
                $bytes = [System.IO.File]::ReadAllBytes($file)
                $res.ContentType = $type
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
                $status = 200
            }
            else {
                $res.StatusCode = 404
                $status = 404
            }
            Write-Host ("{0} /{1}" -f $status, $rel) -ForegroundColor DarkGray
        }
        finally { $res.Close() }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
