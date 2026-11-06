$ErrorActionPreference = 'Stop'
$ProjectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectPath

function Test-PythonExecutable([string]$Path) {
    if (-not $Path -or $Path -match '\\Microsoft\\WindowsApps\\' -or -not (Test-Path $Path)) {
        return $false
    }
    try {
        & $Path -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

$Python = $null
foreach ($EnvironmentName in @('.venv', '.venv-neon')) {
    $Candidate = Join-Path $ProjectPath "$EnvironmentName\Scripts\python.exe"
    if (Test-PythonExecutable $Candidate) {
        $Python = $Candidate
        break
    }
}

if (-not $Python) {
    $PythonCandidates = @()
    foreach ($CommandName in @('python3.11', 'python3', 'python')) {
        $PythonCommand = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($PythonCommand) {
            $PythonCandidates += $PythonCommand.Source
        }
    }
    foreach ($InstallRoot in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python'),
        (Join-Path $env:ProgramFiles 'Python')
    )) {
        if (Test-Path $InstallRoot) {
            $PythonCandidates += Get-ChildItem -LiteralPath $InstallRoot -Directory -Filter 'Python3*' -ErrorAction SilentlyContinue |
                ForEach-Object { Join-Path $_.FullName 'python.exe' }
        }
    }

    $PythonBase = $PythonCandidates | Where-Object { Test-PythonExecutable $_ } | Select-Object -First 1
    $NewEnvironment = Join-Path $ProjectPath '.venv-neon'
    if (Test-Path $NewEnvironment) {
        $EnvironmentName = '.venv-panapp-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
        $NewEnvironment = Join-Path $ProjectPath $EnvironmentName
    }
    if ($PythonBase) {
        & $PythonBase -m venv $NewEnvironment
    } else {
        $PythonLauncher = Get-Command py -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($PythonLauncher) {
            & $PythonLauncher.Source -3.11 -m venv $NewEnvironment
        } else {
            throw "No hay un Python 3.11+ instalado y accesible. Instálalo con: winget install --id Python.Python.3.11 -e --scope user. Luego cierra y abre PowerShell y vuelve a ejecutar .\start-panapp.ps1."
        }
    }
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno virtual de PANAPP.' }
    $Python = Join-Path $NewEnvironment 'Scripts\python.exe'
    if (-not (Test-PythonExecutable $Python)) {
        throw 'El entorno virtual recién creado no pudo ejecutar Python.'
    }
}

$ErrorActionPreference = 'Continue'
$ImportOutput = & $Python -c 'import fastapi, jwt, psycopg, uvicorn' 2>&1
$ImportExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($ImportExitCode -ne 0) {
    Write-Host 'Faltan dependencias de PANAPP; instalando requirements.txt...' -ForegroundColor Yellow
    $ErrorActionPreference = 'Continue'
    & $Python -m pip install -r (Join-Path $ProjectPath 'requirements.txt')
    $InstallExitCode = $LASTEXITCODE
    $ImportOutput = & $Python -c 'import fastapi, jwt, psycopg, uvicorn' 2>&1
    $ImportExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($InstallExitCode -ne 0 -or $ImportExitCode -ne 0) {
        $ImportOutput | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw 'No se pudieron instalar o importar las dependencias. Revisa el error anterior y comprueba la conexión a internet.'
    }
}

$CertificatePath = Join-Path $ProjectPath '.devcert\localhost.pem'
$PrivateKeyPath = Join-Path $ProjectPath '.devcert\localhost-key.pem'
if ((Test-Path $CertificatePath) -xor (Test-Path $PrivateKeyPath)) {
    throw 'Falta el certificado o la llave HTTPS. Genera ambos archivos con mkcert siguiendo el README.'
}
if ((Test-Path $CertificatePath) -and (Test-Path $PrivateKeyPath)) {
    $env:PANAPP_TLS_CERTFILE = $CertificatePath
    $env:PANAPP_TLS_KEYFILE = $PrivateKeyPath
    Write-Host 'HTTPS local habilitado: https://localhost:8765' -ForegroundColor Green
}

Write-Host 'Iniciando PANAPP SaaS con FastAPI y PostgreSQL...' -ForegroundColor Cyan
Write-Host 'La conexión puede venir de DATABASE_URL o de PANAPP_DB_*.' -ForegroundColor Yellow
Write-Host 'Iniciando PANAPP. Para apagar el servidor, presiona Ctrl+C.' -ForegroundColor Green
& $Python (Join-Path $ProjectPath 'saas_app.py')
exit $LASTEXITCODE
