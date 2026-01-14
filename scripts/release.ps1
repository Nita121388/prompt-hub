param(
  [string]$EnvFile = ".env.release",
  [string]$OutDir = "dist",
  [switch]$SkipVerify,
  [switch]$Publish,
  [switch]$Tag,
  [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Info([string]$Message) { Write-Host "[release] $Message" }
function Fail([string]$Message) { throw "[release] $Message" }

function Run-Checked([string]$FilePath, [string[]]$Arguments) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Fail ("Command failed ({0}): {1} {2}" -f $LASTEXITCODE, $FilePath, ($Arguments -join " "))
  }
}

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path $Path)) { return }
  Write-Info "Loading env file: $Path"
  foreach ($rawLine in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
    $line = $rawLine.Trim()
    if (-not $line) { continue }
    if ($line.StartsWith("#")) { continue }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { continue }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($key) { Set-Item -Path "Env:$key" -Value $value }
  }
}

Import-DotEnv $EnvFile

$gitRemote = if ($env:GIT_REMOTE) { $env:GIT_REMOTE } else { "origin" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "node not found; please install Node.js." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm not found; please install Node.js (includes npm)." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "git not found; please install Git." }

$vsce = Join-Path $PSScriptRoot "..\\node_modules\\.bin\\vsce.cmd"
if (-not (Test-Path $vsce)) {
  Fail "Local vsce not found: $vsce; run npm install at repo root first."
}

Push-Location (Join-Path $PSScriptRoot "..")
try {
  $status = (git status --porcelain=v1)
  if ($status -and (-not $AllowDirty)) {
    Fail "Working tree is dirty (includes untracked files). Commit/clean first, or use -AllowDirty."
  }

  $remoteUrl = (git remote get-url $gitRemote 2>$null)
  if (-not $remoteUrl) { Fail "Git remote not found: $gitRemote" }
  if ($env:EXPECTED_GIT_REMOTE_URL -and ($remoteUrl -ne $env:EXPECTED_GIT_REMOTE_URL)) {
    Fail "Remote URL mismatch: current=$remoteUrl; expected=$env:EXPECTED_GIT_REMOTE_URL"
  }

  $version = (node -p "require('./package.json').version")
  if (-not $version) { Fail "Failed to read package.json version" }
  Write-Info "Version: $version"

  $iconPath = (node -p "require('./package.json').icon || ''")
  if (-not $iconPath) { Fail "package.json is missing icon field" }
  if (-not (Test-Path $iconPath)) { Fail "Icon file not found: $iconPath" }

  $changelog = Get-Content -LiteralPath "CHANGELOG.md" -Encoding UTF8
  if (-not ($changelog -match [regex]::Escape("## [$version]"))) {
    Fail "CHANGELOG.md missing section: ## [$version]"
  }

  if (-not $SkipVerify) {
    Write-Info "Running verification: npm run verify"
    Run-Checked "npm.cmd" @("run", "verify")
  } else {
    Write-Info "Skipping verification (-SkipVerify)"
  }

  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
  $vsixPath = Join-Path $OutDir ("otter-$version.vsix")

  Write-Info "Packaging VSIX: $vsixPath"
  Run-Checked $vsce @("package", "-o", $vsixPath)

  $vsixEntries = (tar -tf $vsixPath 2>$null)
  if ($vsixEntries -match '(^|/)\.env(\.|$)' -or $vsixEntries -match '(^|/)extension/\.env') {
    Fail "VSIX contains .env file(s). Check .vscodeignore and retry."
  }

  if ($Tag) {
    $tagName = "v$version"
    $existing = (git tag -l $tagName)
    if ($existing) { Fail "Tag already exists: $tagName" }
    Write-Info "Creating tag: $tagName"
    Run-Checked "git" @("tag", $tagName)
    Write-Info "Pushing tag to $gitRemote"
    Run-Checked "git" @("push", $gitRemote, $tagName)
  }

  if ($Publish) {
    if (-not $env:VSCE_PAT) { Fail "VSCE_PAT is not set (put it in .env.release)" }
    Write-Info "Publishing to VSCode Marketplace: vsce publish"
    Run-Checked $vsce @("publish", "--pat", $env:VSCE_PAT)
  }

  Write-Info "Done"
} finally {
  Pop-Location
}
