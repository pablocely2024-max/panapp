param([switch]$RunOnce)

$ErrorActionPreference = "Stop"

$scriptRepositoryRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = (& git -C $scriptRepositoryRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $repositoryRoot) {
    throw "No se pudo encontrar el repositorio Git."
}
$repositoryRoot = $repositoryRoot.Trim()
Set-Location $repositoryRoot

$excludedPathPattern = '(^|/)(\.git|\.venv[^/]*|node_modules|__pycache__|\.pytest_cache|dist|build|coverage)(/|$)'
$excludedFilePattern = '(^|/)\.env([^/]*)(/|$)|(^|/)\.panapp-secret$|(^|/)[^/]*(secret|credential|private|token|id_rsa|id_ed25519)[^/]*$|(^|/)[^/]+\.(pem|key|p12|pfx)$'
$syncableExtensions = @(
    ".cjs", ".css", ".html", ".ico", ".jpeg", ".jpg", ".js", ".json",
    ".md", ".mjs", ".png", ".py", ".svg", ".toml", ".txt", ".webp",
    ".yaml", ".yml"
)

function Test-SyncablePath {
    param([string]$Path)

    $normalizedPath = $Path.Replace("\", "/")
    if ($normalizedPath.StartsWith("./")) {
        $normalizedPath = $normalizedPath.Substring(2)
    }
    if ($normalizedPath -match $excludedPathPattern -or $normalizedPath -match $excludedFilePattern) {
        return $false
    }
    if ($normalizedPath -ieq ".vscode/settings.json") {
        return $false
    }
    if ($normalizedPath -ieq "scripts/auto-sync.ps1") {
        return $true
    }
    return $syncableExtensions -contains [System.IO.Path]::GetExtension($normalizedPath).ToLowerInvariant()
}

function Invoke-Git {
    param([string[]]$Arguments)

    $output = & git @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        $details = ($output | Out-String).Trim()
        throw "git $($Arguments -join ' ') falló. $details"
    }
    return $output
}

function Sync-Repository {
    $branch = (Invoke-Git -Arguments @("branch", "--show-current") | Out-String).Trim()
    if ($branch -ne "main") {
        Write-Warning "Sincronización pausada: la rama actual es '$branch', no 'main'."
        return
    }

    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 1) {
        Write-Warning "Hay cambios preparados manualmente; se pausa la sincronización para no mezclarlos."
        return
    }
    if ($LASTEXITCODE -gt 1) {
        throw "No se pudo revisar el índice de Git."
    }

    $status = Invoke-Git -Arguments @("status", "--porcelain=v1", "--untracked-files=all", "--no-renames")
    $syncablePaths = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $status) {
        $line = [string]$entry
        if ($line.Length -lt 4) {
            continue
        }
        $relativePath = $line.Substring(3)
        if (Test-SyncablePath $relativePath) {
            $syncablePaths.Add($relativePath)
        }
    }

    if ($syncablePaths.Count -gt 0) {
        foreach ($relativePath in $syncablePaths) {
            Invoke-Git -Arguments @("add", "--", $relativePath) | Out-Null
        }

        $stagedPaths = Invoke-Git -Arguments @("diff", "--cached", "--name-only")
        if ($stagedPaths.Count -gt 0) {
            Invoke-Git -Arguments @("diff", "--cached", "--check") | Out-Null
            $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            $message = "Auto-sync workspace changes ($timestamp)"
            Invoke-Git -Arguments @(
                "commit",
                "-m", $message,
                "-m", "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
            ) | Out-Null
            Write-Host "Cambios guardados en un commit; subiendo a GitHub..." -ForegroundColor Cyan
        }
    }

    $ahead = [int]((Invoke-Git -Arguments @("rev-list", "--count", "origin/main..HEAD") | Out-String).Trim())
    if ($ahead -gt 0) {
        Invoke-Git -Arguments @("push", "origin", "main") | Out-Null
        Write-Host "Sincronizado con GitHub (main)." -ForegroundColor Green
    }
}

Write-Host "PANAPP auto-sync activo: los cambios compatibles se publican tras 5 segundos sin ediciones." -ForegroundColor Green
Write-Host "Se excluyen entornos, archivos .env, claves y .vscode/settings.json." -ForegroundColor Yellow

if ($RunOnce) {
    Sync-Repository
    exit 0
}

$watcher = [System.IO.FileSystemWatcher]::new($repositoryRoot)
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName `
    -bor [System.IO.NotifyFilters]::DirectoryName `
    -bor [System.IO.NotifyFilters]::LastWrite
$watcher.EnableRaisingEvents = $true

$sourceIdentifiers = @()
foreach ($eventName in @("Changed", "Created", "Deleted", "Renamed")) {
    $sourceIdentifier = "PanappAutoSync$eventName"
    Register-ObjectEvent -InputObject $watcher -EventName $eventName -SourceIdentifier $sourceIdentifier | Out-Null
    $sourceIdentifiers += $sourceIdentifier
}

$pendingSync = $false
$lastChange = [DateTime]::MinValue
$nextRetry = [DateTime]::MinValue
try {
    while ($true) {
        $event = Wait-Event -Timeout 1
        if ($event) {
            $eventPath = $event.SourceEventArgs.FullPath
            if ($eventPath -and -not $eventPath.StartsWith(
                (Join-Path $repositoryRoot ".git"),
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
                $pendingSync = $true
                $lastChange = [DateTime]::UtcNow
            }
            Remove-Event -EventIdentifier $event.EventIdentifier
        }

        $now = [DateTime]::UtcNow
        $quietForSeconds = ($now - $lastChange).TotalSeconds
        if ($pendingSync -and $quietForSeconds -ge 5) {
            $pendingSync = $false
            try {
                Sync-Repository
                $nextRetry = [DateTime]::MinValue
            }
            catch {
                Write-Host "Error de sincronización: $_" -ForegroundColor Red
                $nextRetry = $now.AddSeconds(30)
            }
        }
        elseif ($nextRetry -ne [DateTime]::MinValue -and $now -ge $nextRetry) {
            try {
                Sync-Repository
                $nextRetry = [DateTime]::MinValue
            }
            catch {
                Write-Host "Error de sincronización: $_" -ForegroundColor Red
                $nextRetry = $now.AddSeconds(30)
            }
        }
    }
}
finally {
    $watcher.EnableRaisingEvents = $false
    $watcher.Dispose()
    foreach ($sourceIdentifier in $sourceIdentifiers) {
        Unregister-Event -SourceIdentifier $sourceIdentifier -ErrorAction SilentlyContinue
    }
}
