[CmdletBinding()]
param(
  [ValidateSet("run", "status", "stop")]
  [string]$Action = "run",
  [int]$MaxRuns = 0,
  [int]$RestartDelaySeconds = 3,
  [int]$TailSeconds = 15,
  [int]$RunTimeoutMinutes = 10,
  [int]$FixTimeoutMinutes = 10,
  [string]$DemoDir,
  [string]$TaskTemplate,
  [string]$PackageTemplate,
  [string]$Target = "codex",
  [string]$CodexModel = "gpt-5.4",
  [string]$CodexReasoningEffort = "medium",
  [switch]$SkipValidate,
  [switch]$SkipFix
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptRoot = if ($PSScriptRoot) {
  $PSScriptRoot
} elseif ($MyInvocation.MyCommand.Path) {
  Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
  (Get-Location).Path
}

$DemoDir = if ($DemoDir) { $DemoDir } else { Join-Path $ScriptRoot "..\\demo" }
$TaskTemplate = if ($TaskTemplate) { $TaskTemplate } else { Join-Path $ScriptRoot "demo-template\\CODEX_TASK.md" }
$PackageTemplate = if ($PackageTemplate) { $PackageTemplate } else { Join-Path $ScriptRoot "demo-template\\package.json" }
$IsWindowsPlatform = $env:OS -eq "Windows_NT"
$RepoRoot = (Resolve-Path (Join-Path $ScriptRoot "..")).Path
$DemoDir = [System.IO.Path]::GetFullPath($DemoDir)
$LoopRoot = Join-Path $RepoRoot ".cache\\codex-demo-loop"
$RunsRoot = Join-Path $LoopRoot "runs"
$FixesRoot = Join-Path $LoopRoot "fixes"
$StateFile = Join-Path $LoopRoot "current-run.json"
$StopFile = Join-Path $LoopRoot "STOP"

function Write-Step {
  param([string]$Message)
  Write-Host "[codex-loop] $Message"
}

function Ensure-Dir {
  param([string]$Path)
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Quote-PsLiteral {
  param([string]$Value)
  return "'{0}'" -f ($Value -replace "'", "''")
}

function Invoke-Npm {
  param(
    [string[]]$Arguments,
    [string]$WorkingDirectory = $RepoRoot,
    [string]$LogPath
  )

  Push-Location $WorkingDirectory
  try {
    Write-Step ("npm " + ($Arguments -join " "))
    if ($LogPath) {
      & npm @Arguments 2>&1 | Tee-Object -FilePath $LogPath | Out-Host
    } else {
      & npm @Arguments
    }
    if ($LASTEXITCODE -ne 0) {
      throw "npm command failed: npm $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Invoke-LocalCli {
  param(
    [string[]]$Arguments,
    [string]$WorkingDirectory = $DemoDir,
    [string]$LogPath
  )

  $CliPath = Join-Path $DemoDir "node_modules\\naver-commerce-api-docs-cli\\dist\\cli.js"
  if (-not (Test-Path $CliPath)) {
    throw "CLI entrypoint not found: $CliPath"
  }

  Push-Location $WorkingDirectory
  try {
    if ($LogPath) {
      & node $CliPath @Arguments 2>&1 | Tee-Object -FilePath $LogPath | Out-Host
    } else {
      & node $CliPath @Arguments
    }

    if ($LASTEXITCODE -ne 0) {
      throw "CLI command failed: node $CliPath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Stop-ActiveProcess {
  if (-not (Test-Path $StateFile)) {
    return
  }

  $state = Get-Content $StateFile -Raw | ConvertFrom-Json
  if (-not $state.activePid) {
    return
  }

  $pidValue = [int]$state.activePid
  Write-Step "Stopping active process pid $pidValue"

  try {
    if ($IsWindowsPlatform) {
      & taskkill /PID $pidValue /T /F *> $null
      if ($LASTEXITCODE -ne 0) {
        throw "taskkill exited with code $LASTEXITCODE"
      }
    } else {
      Stop-Process -Id $pidValue -Force -ErrorAction Stop
    }
  } catch {
    Write-Step "Unable to stop pid $pidValue automatically: $($_.Exception.Message)"
  }
}

function Reset-DemoWorkspace {
  Write-Step "Resetting demo workspace"
  if (Test-Path $DemoDir) {
    Remove-Item $DemoDir -Recurse -Force
  }

  Ensure-Dir $DemoDir
  Ensure-Dir (Join-Path $DemoDir "runtime")
}

function Copy-DemoTemplates {
  Write-Step "Writing demo templates"
  Copy-Item $TaskTemplate (Join-Path $DemoDir "CODEX_TASK.md") -Force
  Copy-Item $PackageTemplate (Join-Path $DemoDir "package.json") -Force
}

function Install-LinkModePackage {
  Write-Step "Linking current workspace into demo/node_modules"

  $NodeModules = Join-Path $DemoDir "node_modules"
  $BinDir = Join-Path $NodeModules ".bin"
  $PackageLink = Join-Path $NodeModules "naver-commerce-api-docs-cli"

  Ensure-Dir $NodeModules
  Ensure-Dir $BinDir

  if ($IsWindowsPlatform) {
    New-Item -ItemType Junction -Path $PackageLink -Target $RepoRoot | Out-Null
  } else {
    New-Item -ItemType SymbolicLink -Path $PackageLink -Target $RepoRoot | Out-Null
  }

  $shimCmd = @"
@ECHO OFF
SETLOCAL
node "%~dp0\..\naver-commerce-api-docs-cli\dist\cli.js" %*
"@
  $shimPs1 = @"
#!/usr/bin/env pwsh
`$cli = Join-Path `$PSScriptRoot '..' 'naver-commerce-api-docs-cli' 'dist' 'cli.js'
& node `$cli @args
exit `$LASTEXITCODE
"@
  $shimSh = @'
#!/bin/sh
node "$(dirname "$0")/../naver-commerce-api-docs-cli/dist/cli.js" "$@"
'@

  foreach ($name in @("naver-commerce-api-docs-cli", "ncad")) {
    Set-Content (Join-Path $BinDir "$name.cmd") $shimCmd
    Set-Content (Join-Path $BinDir "$name.ps1") $shimPs1
    Set-Content (Join-Path $BinDir $name) $shimSh
  }
}

function Get-RunLabel {
  param([int]$RunNumber)
  return "{0:yyyyMMdd-HHmmss}-run-{1:D3}" -f (Get-Date), $RunNumber
}

function Save-State {
  param(
    [string]$RunLabel,
    [int]$RunNumber,
    [string]$Phase,
    [int]$ActivePid,
    [string]$EventsPath,
    [string]$ErrorPath
  )

  Ensure-Dir $LoopRoot

  $state = [ordered]@{
    runLabel = $RunLabel
    runNumber = $RunNumber
    phase = $Phase
    activePid = $ActivePid
    demoDir = $DemoDir
    eventsPath = $EventsPath
    stderrPath = $ErrorPath
    fixesRoot = $FixesRoot
    stateFile = $StateFile
    stopFile = $StopFile
    updatedAt = (Get-Date).ToString("o")
  }

  $state | ConvertTo-Json -Depth 5 | Set-Content $StateFile
}

function Finalize-State {
  param(
    [string]$RunLabel,
    [int]$RunNumber,
    [string]$Phase,
    [string]$EventsPath,
    [string]$ErrorPath
  )

  Save-State -RunLabel $RunLabel -RunNumber $RunNumber -Phase $Phase -ActivePid 0 -EventsPath $EventsPath -ErrorPath $ErrorPath
}

function Read-NewLines {
  param(
    [string]$Path,
    [int]$SeenCount
  )

  if (-not (Test-Path $Path)) {
    return @{ SeenCount = $SeenCount; Lines = @() }
  }

  $lines = @(Get-Content $Path)
  if ($lines.Count -le $SeenCount) {
    return @{ SeenCount = $SeenCount; Lines = @() }
  }

  $newLines = @($lines[$SeenCount..($lines.Count - 1)])
  return @{ SeenCount = $lines.Count; Lines = $newLines }
}

function Wait-ForCodexProcess {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$EventsPath,
    [string]$ErrorPath,
    [int]$TimeoutMinutes,
    [int]$TailWindowSeconds
  )

  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  $seenEvents = 0
  $seenErrors = 0
  $timedOut = $false

  while (-not $Process.HasExited) {
    $events = Read-NewLines -Path $EventsPath -SeenCount $seenEvents
    $seenEvents = $events.SeenCount
    foreach ($line in $events.Lines) {
      if ($line) {
        Write-Host $line
      }
    }

    $errors = Read-NewLines -Path $ErrorPath -SeenCount $seenErrors
    $seenErrors = $errors.SeenCount
    foreach ($line in $errors.Lines) {
      if ($line) {
        Write-Host "[codex-loop][stderr] $line"
      }
    }

    if ((Get-Date) -gt $deadline) {
      Write-Step "Codex process exceeded timeout of $TimeoutMinutes minutes; stopping it"
      try {
        if ($IsWindowsPlatform) {
          & taskkill /PID $Process.Id /T /F *> $null
          if ($LASTEXITCODE -ne 0) {
            throw "taskkill exited with code $LASTEXITCODE"
          }
        } else {
          Stop-Process -Id $Process.Id -Force -ErrorAction Stop
        }
      } catch {
        Write-Step "Unable to stop timed-out pid $($Process.Id): $($_.Exception.Message)"
      }
      $timedOut = $true
      break
    }

    Start-Sleep -Milliseconds 750
  }

  if ($TailWindowSeconds -gt 0) {
    $tailDeadline = (Get-Date).AddSeconds($TailWindowSeconds)
    while ((Get-Date) -lt $tailDeadline) {
      $events = Read-NewLines -Path $EventsPath -SeenCount $seenEvents
      $seenEvents = $events.SeenCount
      foreach ($line in $events.Lines) {
        if ($line) {
          Write-Host $line
        }
      }

      $errors = Read-NewLines -Path $ErrorPath -SeenCount $seenErrors
      $seenErrors = $errors.SeenCount
      foreach ($line in $errors.Lines) {
        if ($line) {
          Write-Host "[codex-loop][stderr] $line"
        }
      }

      if ($events.Lines.Count -eq 0 -and $errors.Lines.Count -eq 0) {
        break
      }

      Start-Sleep -Milliseconds 400
    }
  }

  $Process.WaitForExit()

  return @{
    ExitCode = $Process.ExitCode
    TimedOut = $timedOut
  }
}

function Archive-Run {
  param([string]$RunLabel)

  $archiveDir = Join-Path $RunsRoot $RunLabel
  Ensure-Dir $archiveDir

  foreach ($path in @(
    "CODEX_TASK.md",
    "package.json",
    "AGENTS.md",
    ".agents",
    "runtime",
    "codex-child"
  )) {
    $source = Join-Path $DemoDir $path
    if (Test-Path $source) {
      Copy-Item $source (Join-Path $archiveDir $path) -Recurse -Force
    }
  }

  Write-Step "Archived run artifacts to $archiveDir"
  return $archiveDir
}

function Start-CodexExec {
  param(
    [string]$WorkingDirectory,
    [string]$PromptFile,
    [string]$OutputDirectory,
    [string]$RunLabel,
    [string]$Phase
  )

  $codex = Get-Command codex -ErrorAction Stop
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if (-not $pwsh) {
    $pwsh = Get-Command powershell -ErrorAction Stop
  }
  $eventsPath = Join-Path $OutputDirectory "events.jsonl"
  $errorPath = Join-Path $OutputDirectory "stderr.log"
  $lastPath = Join-Path $OutputDirectory "last.txt"

  Ensure-Dir $OutputDirectory

  $workingLiteral = Quote-PsLiteral $WorkingDirectory
  $promptLiteral = Quote-PsLiteral $PromptFile
  $codexLiteral = Quote-PsLiteral $codex.Source
  $lastLiteral = Quote-PsLiteral $lastPath

  $childCommand = @(
    "Set-Location $workingLiteral",
    "`$prompt = Get-Content -Raw $promptLiteral",
    "& $codexLiteral exec --json --full-auto -m $CodexModel -c 'model_reasoning_effort=""$CodexReasoningEffort""' -C . --skip-git-repo-check --output-last-message $lastLiteral `$prompt"
  ) -join "; "

  $startParams = @{
    FilePath = $pwsh.Source
    WorkingDirectory = $WorkingDirectory
    ArgumentList = @("-NoLogo", "-NoProfile", "-Command", $childCommand)
    RedirectStandardOutput = $eventsPath
    RedirectStandardError = $errorPath
    PassThru = $true
  }

  if ($IsWindowsPlatform) {
    $startParams.WindowStyle = "Hidden"
  }

  $process = Start-Process @startParams
  Write-Step "Started Codex $Phase pid $($process.Id) for $RunLabel"

  return @{
    Process = $process
    EventsPath = $eventsPath
    ErrorPath = $errorPath
  }
}

function Verify-DemoRun {
  $issues = New-Object System.Collections.Generic.List[string]
  $testLog = Join-Path $DemoDir "runtime\\demo-test.log"
  $eventsPath = Join-Path $DemoDir "runtime\\events.jsonl"
  $childDir = Join-Path $DemoDir "codex-child"
  $initLog = Join-Path $DemoDir "runtime\\init.jsonl"
  $validateLog = Join-Path $DemoDir "runtime\\validate.jsonl"
  $agentsPath = Join-Path $DemoDir "AGENTS.md"
  $skillPath = Join-Path $DemoDir ".agents\\skills\\naver-commerce-api-docs-cli\\SKILL.md"
  $clientPath = Join-Path $childDir "client.mjs"
  $testPath = Join-Path $childDir "client.test.mjs"
  $reportPath = Join-Path $childDir "REPORT.md"

  if (-not (Test-Path $agentsPath)) {
    $issues.Add("Missing installed AGENTS.md: $agentsPath")
  }

  if (-not (Test-Path $skillPath)) {
    $issues.Add("Missing installed Codex skill: $skillPath")
  }

  if (-not (Test-Path $initLog)) {
    $issues.Add("Missing init log: $initLog")
  } else {
    $initText = Get-Content $initLog -Raw
    if ($initText -notmatch '"event":"file"') {
      $issues.Add("Init log does not contain file installation events: $initLog")
    }
    if ($initText -notmatch '"event":"done"' -or $initText -notmatch '"event":"guide"') {
      $issues.Add("Init log does not contain completion events: $initLog")
    }
  }

  if (-not $SkipValidate) {
    if (-not (Test-Path $validateLog)) {
      $issues.Add("Missing validate log: $validateLog")
    } else {
      $validateText = Get-Content $validateLog -Raw
      if ($validateText -notmatch '"cmd":"check"' -or $validateText -notmatch '"event":"done"' -or $validateText -notmatch '"event":"guide"') {
        $issues.Add("Validate log does not contain the expected check completion events: $validateLog")
      }
    }
  }

  if (-not (Test-Path $eventsPath)) {
    $issues.Add("Missing Codex event log: $eventsPath")
  } else {
    $eventsText = Get-Content $eventsPath -Raw
    $commandExecutionTexts = New-Object System.Collections.Generic.List[string]
    foreach ($line in (Get-Content $eventsPath)) {
      try {
        $event = $line | ConvertFrom-Json -ErrorAction Stop
        if ($null -ne $event.item -and $event.item.type -eq "command_execution" -and $event.item.command) {
          $commandExecutionTexts.Add([string]$event.item.command)
        }
      } catch {
      }
    }
    $commandText = $commandExecutionTexts -join "`n"
    $askIndex = $eventsText.IndexOf("naver-commerce-api-docs-cli ask ")
    $tokenApiIndex = $eventsText.IndexOf("api --path /v1/oauth2/token --method POST --body")
    $productApiIndex = $eventsText.IndexOf("api --path /v2/products --method POST --body")
    $searchApiIndex = $eventsText.IndexOf("api --path /v1/products/search --method POST --body")
    $groundingCompleteIndex = $eventsText.IndexOf("GROUNDING_COMPLETE")
    $fileChangeIndex = $eventsText.IndexOf('"type":"file_change"')
    if ($commandText -notmatch '(?:^|["\s])npx(?:\.cmd)?\s+(?:--no-install\s+)?naver-commerce-api-docs-cli|(?:^|["\s])(?:naver-commerce-api-docs-cli|ncad)(?:\.cmd)?\s+(?:ask|api|review|noise|lint|validate|sync)') {
      $issues.Add("Codex child did not invoke the CLI as a subprocess according to events.jsonl")
    }
    if ($askIndex -lt 0) {
      $issues.Add("Codex child did not record a natural-language ask query before implementation")
    }
    if ($tokenApiIndex -lt 0) {
      $issues.Add("Codex child did not run an exact api lookup for POST /v1/oauth2/token")
    }
    if ($productApiIndex -lt 0) {
      $issues.Add("Codex child did not run an exact api lookup for POST /v2/products")
    }
    if ($searchApiIndex -lt 0) {
      $issues.Add("Codex child did not run an exact api lookup for POST /v1/products/search")
    }
    if ($groundingCompleteIndex -lt 0) {
      $issues.Add("Codex child did not emit the GROUNDING_COMPLETE marker after retrieval")
    } elseif ($searchApiIndex -lt 0 -or $groundingCompleteIndex -lt $searchApiIndex) {
      $issues.Add("Codex child emitted GROUNDING_COMPLETE before finishing the required exact api lookups")
    }
    if ($fileChangeIndex -ge 0) {
      if ($askIndex -lt 0 -or $askIndex -gt $fileChangeIndex) {
        $issues.Add("Codex child started writing files before the ask evidence step completed")
      }
      if ($tokenApiIndex -lt 0 -or $tokenApiIndex -gt $fileChangeIndex) {
        $issues.Add("Codex child started writing files before the token api lookup completed")
      }
      if ($productApiIndex -lt 0 -or $productApiIndex -gt $fileChangeIndex) {
        $issues.Add("Codex child started writing files before the product api lookup completed")
      }
      if ($searchApiIndex -lt 0 -or $searchApiIndex -gt $fileChangeIndex) {
        $issues.Add("Codex child started writing files before the product search api lookup completed")
      }
      if ($groundingCompleteIndex -lt 0 -or $groundingCompleteIndex -gt $fileChangeIndex) {
        $issues.Add("Codex child started writing files before emitting GROUNDING_COMPLETE")
      }
    }
    if ($commandText -match 'naver-commerce-api-docs-cli[\\/\\\\]+dist[\\/\\\\]+(ask|api|cli|review|noise|lint|transform|sync)|import\s+\{\s*run\s+as') {
      $issues.Add("Codex child imported package internals instead of calling the CLI subprocess")
    }
    if ($eventsText -match 'search_query|image_query|recipient_name":"web|web\.run') {
      $issues.Add("Codex child appears to use web search or browsing instead of the CLI-first path")
    }
  }

  foreach ($required in @(
    $clientPath,
    $testPath,
    $reportPath
  )) {
    if (-not (Test-Path $required)) {
      $issues.Add("Missing expected output: $required")
    }
  }

  if (Test-Path $clientPath) {
    $clientText = Get-Content $clientPath -Raw
    foreach ($symbol in @("issueToken", "createProduct", "searchProducts", "createAndVerifyProduct")) {
      if ($clientText -notmatch ("\b" + [regex]::Escape($symbol) + "\b")) {
        $issues.Add("client.mjs does not contain expected symbol: $symbol")
      }
    }
  }

  if (Test-Path $testPath) {
    $testText = Get-Content $testPath -Raw
    foreach ($symbol in @("searchProducts", "createAndVerifyProduct")) {
      if ($testText -notmatch ("\b" + [regex]::Escape($symbol) + "\b")) {
        $issues.Add("client.test.mjs does not cover expected symbol: $symbol")
      }
    }
  }

  if (Test-Path $reportPath) {
    $reportText = Get-Content $reportPath -Raw
    if ($reportText -notmatch "/v1/products/search") {
      $issues.Add("REPORT.md does not cite the product search endpoint evidence")
    }
  }

  $testFiles = @(Get-ChildItem $childDir -Filter "*.test.mjs" -File -ErrorAction SilentlyContinue)
  if ($testFiles.Count -eq 0) {
    $issues.Add("No demo test files were generated in codex-child/")
  } else {
    Push-Location $DemoDir
    try {
        & node --test --test-isolation=none @($testFiles.FullName) 2>&1 | Tee-Object -FilePath $testLog | Out-Host
        if ($LASTEXITCODE -ne 0) {
          $issues.Add("Demo tests failed; see $testLog")
        }
    } finally {
      Pop-Location
    }
  }

  return @{
    Ok = ($issues.Count -eq 0)
    Issues = $issues.ToArray()
    TestLog = $testLog
  }
}

function Get-RunFailureReasons {
  param(
    [hashtable]$ChildResult,
    [hashtable]$Verification
  )

  $reasons = New-Object System.Collections.Generic.List[string]

  if ($null -eq $ChildResult) {
    $reasons.Add("Child run result was not captured")
  } else {
    if ($null -ne $ChildResult.ExitCode -and $ChildResult.ExitCode -ne 0) {
      $reasons.Add("Child run exited with code $($ChildResult.ExitCode)")
    }

    if ($ChildResult.TimedOut) {
      $reasons.Add("Child run exceeded the timeout")
    }
  }

  if ($null -eq $Verification) {
    $reasons.Add("Post-run verification did not return a result")
  } else {
    foreach ($issue in @($Verification.Issues)) {
      if (-not [string]::IsNullOrWhiteSpace($issue)) {
        $reasons.Add($issue)
      }
    }
  }

  return $reasons.ToArray()
}

function Assert-Bootstrap {
  param([bool]$RequireValidate)

  $issues = New-Object System.Collections.Generic.List[string]
  $initLog = Join-Path $DemoDir "runtime\\init.jsonl"
  $validateLog = Join-Path $DemoDir "runtime\\validate.jsonl"
  $agentsPath = Join-Path $DemoDir "AGENTS.md"
  $skillPath = Join-Path $DemoDir ".agents\\skills\\naver-commerce-api-docs-cli\\SKILL.md"

  if (-not (Test-Path $agentsPath)) {
    $issues.Add("AGENTS.md was not installed")
  }

  if (-not (Test-Path $skillPath)) {
    $issues.Add("Codex skill was not installed")
  }

  if (-not (Test-Path $initLog)) {
    $issues.Add("runtime/init.jsonl was not created")
  } else {
    $initText = Get-Content $initLog -Raw
    if ($initText -notmatch '"event":"file"') {
      $issues.Add("runtime/init.jsonl does not contain file installation events")
    }
    if ($initText -notmatch '"event":"done"' -or $initText -notmatch '"event":"guide"') {
      $issues.Add("runtime/init.jsonl does not contain completion events")
    }
  }

  if ($RequireValidate) {
    if (-not (Test-Path $validateLog)) {
      $issues.Add("runtime/validate.jsonl was not created")
    } else {
      $validateText = Get-Content $validateLog -Raw
      if ($validateText -notmatch '"cmd":"check"' -or $validateText -notmatch '"event":"done"' -or $validateText -notmatch '"event":"guide"') {
        $issues.Add("runtime/validate.jsonl does not contain expected check completion events")
      }
    }
  }

  if ($issues.Count -gt 0) {
    throw ("Bootstrap failed:`n- " + ($issues -join "`n- "))
  }
}

function Invoke-FixCodex {
  param(
    [string]$RunLabel,
    [int]$RunNumber,
    [string]$ArchiveDir,
    [int]$ChildExitCode,
    [bool]$TimedOut,
    [string[]]$FailureReasons
  )

  $fixDir = Join-Path $FixesRoot $RunLabel
  Ensure-Dir $fixDir

  $issuesText = if ($FailureReasons.Count -gt 0) {
    ($FailureReasons | ForEach-Object { "- $_" }) -join [Environment]::NewLine
  } else {
    "- The loop entered fix mode without a recorded failure reason. Inspect loop automation."
  }

  $promptFile = Join-Path $fixDir "FIX_TASK.md"
  $prompt = @"
The automated demo loop found a failure in run `$RunLabel.

Context:
- Root repository: $RepoRoot
- Archived demo artifacts: $ArchiveDir
- Demo directory used during execution: $DemoDir
- Child exit code: $ChildExitCode
- Timed out: $TimedOut

Observed problems:
$issuesText

Task:
- Fix and optimize the root repository so the next demo cycle succeeds more reliably.
- Focus on the highest-leverage root cause in the CLI, installed skill guidance, retrieval quality, or loop automation.
- You may edit source, tests, README, and scripts in the root repository.
- Do not edit files inside `.cache/` or the archived run directory.
- Run the relevant validation commands before finishing.
- Keep the fix minimal and defensible.
"@
  Set-Content $promptFile $prompt

  $exec = Start-CodexExec -WorkingDirectory $RepoRoot -PromptFile $promptFile -OutputDirectory $fixDir -RunLabel $RunLabel -Phase "fix"
  Save-State -RunLabel $RunLabel -RunNumber $RunNumber -Phase "fix" -ActivePid $exec.Process.Id -EventsPath $exec.EventsPath -ErrorPath $exec.ErrorPath
  $result = Wait-ForCodexProcess -Process $exec.Process -EventsPath $exec.EventsPath -ErrorPath $exec.ErrorPath -TimeoutMinutes $FixTimeoutMinutes -TailWindowSeconds 5

  try {
    Invoke-Npm -Arguments @("run", "build") -LogPath (Join-Path $fixDir "post-fix-build.log")
  } catch {
    Write-Step "Post-fix build failed: $($_.Exception.Message)"
  }

  return @{
    ExitCode = $result.ExitCode
    TimedOut = $result.TimedOut
    FixDir = $fixDir
  }
}

function Show-Status {
  if (-not (Test-Path $StateFile)) {
    Write-Step "No active or previous loop state found"
    return
  }

  $state = Get-Content $StateFile -Raw | ConvertFrom-Json
  Write-Host ($state | ConvertTo-Json -Depth 5)

  foreach ($path in @($state.eventsPath, $state.stderrPath)) {
    if (Test-Path $path) {
      Write-Step "Tail of $path"
      Get-Content $path -Tail 20
    }
  }
}

function Run-Loop {
  Ensure-Dir $LoopRoot
  Ensure-Dir $RunsRoot
  Ensure-Dir $FixesRoot

  if (Test-Path $StopFile) {
    Remove-Item $StopFile -Force
  }

  $runNumber = 1
  while ($true) {
    if ($MaxRuns -gt 0 -and $runNumber -gt $MaxRuns) {
      Write-Step "Reached MaxRuns=$MaxRuns"
      break
    }

    if (Test-Path $StopFile) {
      Write-Step "Stop flag detected at $StopFile"
      break
    }

    $runLabel = Get-RunLabel -RunNumber $runNumber
    Write-Step "Preparing $runLabel"

    Stop-ActiveProcess
    Reset-DemoWorkspace
    Copy-DemoTemplates

    Invoke-Npm -Arguments @("run", "build")
    Install-LinkModePackage

    $runtimeDir = Join-Path $DemoDir "runtime"
    Invoke-LocalCli -Arguments @("init", "--target", $Target, "--root", ".") -LogPath (Join-Path $runtimeDir "init.jsonl")

    if (-not $SkipValidate) {
      Invoke-LocalCli -Arguments @("validate") -LogPath (Join-Path $runtimeDir "validate.jsonl")
    }

    Assert-Bootstrap -RequireValidate (-not $SkipValidate)

    $promptFile = Join-Path $DemoDir "CODEX_TASK.md"
    $launcher = Start-CodexExec -WorkingDirectory $DemoDir -PromptFile $promptFile -OutputDirectory $runtimeDir -RunLabel $runLabel -Phase "demo"
    Save-State -RunLabel $runLabel -RunNumber $runNumber -Phase "demo" -ActivePid $launcher.Process.Id -EventsPath $launcher.EventsPath -ErrorPath $launcher.ErrorPath
    $childResult = Wait-ForCodexProcess -Process $launcher.Process -EventsPath $launcher.EventsPath -ErrorPath $launcher.ErrorPath -TimeoutMinutes $RunTimeoutMinutes -TailWindowSeconds $TailSeconds
    $verification = Verify-DemoRun
    $archiveDir = Archive-Run -RunLabel $runLabel
    $failureReasons = @(Get-RunFailureReasons -ChildResult $childResult -Verification $verification)
    $finalPhase = "completed"
    $finalEventsPath = $launcher.EventsPath
    $finalErrorPath = $launcher.ErrorPath

    if ($failureReasons.Count -gt 0) {
      Write-Step "Run $runLabel failed verification"
      foreach ($reason in $failureReasons) {
        Write-Step "Issue: $reason"
      }

      $finalPhase = "failed"
      if (-not $SkipFix) {
        $fix = Invoke-FixCodex -RunLabel $runLabel -RunNumber $runNumber -ArchiveDir $archiveDir -ChildExitCode $childResult.ExitCode -TimedOut $childResult.TimedOut -FailureReasons $failureReasons
        Write-Step "Fix phase finished with exitCode=$($fix.ExitCode) timedOut=$($fix.TimedOut)"
        $finalPhase = if ($fix.ExitCode -eq 0 -and -not $fix.TimedOut) { "fix_completed" } else { "fix_failed" }
        $finalEventsPath = Join-Path $fix.FixDir "events.jsonl"
        $finalErrorPath = Join-Path $fix.FixDir "stderr.log"
      }
    } else {
      Write-Step "Run $runLabel completed successfully"
    }

    Finalize-State -RunLabel $runLabel -RunNumber $runNumber -Phase $finalPhase -EventsPath $finalEventsPath -ErrorPath $finalErrorPath

    $runNumber++

    if (Test-Path $StopFile) {
      Write-Step "Stop flag detected after run completion"
      break
    }

    if ($RestartDelaySeconds -gt 0) {
      Write-Step "Sleeping $RestartDelaySeconds seconds before restart"
      Start-Sleep -Seconds $RestartDelaySeconds
    }
  }
}

switch ($Action) {
  "run" {
    Run-Loop
  }
  "status" {
    Show-Status
  }
  "stop" {
    Ensure-Dir $LoopRoot
    Set-Content $StopFile "stop"
    Stop-ActiveProcess
    Write-Step "Stop flag written to $StopFile"
  }
}
