$root = "d:\GitHub\MGA-CineAudio-Reviewer"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$port = 8765
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
$job = Start-Job -ScriptBlock {
    param($root, $port)
    while ($true) {
        $ctx = $listener.GetContext()
        $reqPath = $ctx.Request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($reqPath)) { $reqPath = 'index.html' }
        $file = Join-Path $root ($reqPath -replace '/', '\')
        if (-not (Test-Path $file)) {
            $ctx.Response.StatusCode = 404
            $ctx.Response.Close()
            continue
        }
        $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
        $types = @{
            '.html' = 'text/html; charset=utf-8'
            '.js'   = 'application/javascript; charset=utf-8'
            '.css'  = 'text/css; charset=utf-8'
        }
        $ctx.Response.ContentType = $types[$ext]
        if (-not $types.ContainsKey($ext)) { $ctx.Response.ContentType = 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($file)
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $ctx.Response.Close()
    }
} -ArgumentList $root, $port
Start-Sleep -Milliseconds 300
$errFile = Join-Path $env:TEMP "mga-console.log"
if (Test-Path $errFile) { Remove-Item $errFile -Force }
& $chrome --headless=new --disable-gpu --enable-logging=stderr --v=0 `
    "http://127.0.0.1:$port/index.html" 2> $errFile | Out-Null
Start-Sleep -Seconds 3
$listener.Stop()
Remove-Job $job -Force -ErrorAction SilentlyContinue
Get-Content $errFile -ErrorAction SilentlyContinue | Select-String -Pattern "error|Error|Uncaught|SyntaxError|ReferenceError" | Select-Object -First 25
