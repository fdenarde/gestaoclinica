param(
  [switch]$ValidateOnly,
  [switch]$Activate
)

$ErrorActionPreference = "Stop"

if ($ValidateOnly -eq $Activate) {
  throw "Informe exatamente um modo: -ValidateOnly para validação segura, ou -Activate para uma ativação futura autorizada."
}

Set-StrictMode -Version Latest

$ExpectedProjectDirectoryName = "gestão-clínica-fábio-denarde"
$TaskName = "AtivacaoRoboWhatsapp20260620"
$ActivationId = [guid]::NewGuid().ToString("N")
$CorruptedPathPatterns = @("Ã", "Â", "├", "│", "┬", "┤", "┐", "└", "─", [char]0xFFFD)
$ProtectedWindows = @(
  @{ Start = "06:20"; End = "06:50"; Label = "06:20-06:50" },
  @{ Start = "08:20"; End = "09:20"; Label = "08:20-09:20" },
  @{ Start = "11:50"; End = "12:50"; Label = "11:50-12:50" }
)

function Test-CorruptedText {
  param([Parameter(Mandatory)][string]$Value)
  foreach ($pattern in $CorruptedPathPatterns) {
    if ($Value.Contains([string]$pattern)) { return $true }
  }
  return $false
}

function Convert-ToFoldedName {
  param([Parameter(Mandatory)][string]$Value)
  $normalized = $Value.Normalize([System.Text.NormalizationForm]::FormD)
  $builder = [System.Text.StringBuilder]::new()
  foreach ($char in $normalized.ToCharArray()) {
    $category = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($char)
    if ($category -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
      if ([char]::IsLetterOrDigit($char)) {
        [void]$builder.Append($char)
      }
    }
  }
  return $builder.ToString().ToLowerInvariant()
}

function Resolve-ProjectRoot {
  if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    throw "PSScriptRoot ausente; o ativador deve ser executado a partir do arquivo .ps1."
  }
  $root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
  if (Test-CorruptedText $root) {
    throw "ProjectRoot recusado por conter caracteres corrompidos: $root"
  }
  $leafName = (Split-Path -Leaf $root)
  $foldedLeafName = Convert-ToFoldedName $leafName
  if (-not ($foldedLeafName.StartsWith("gest") -and $foldedLeafName.EndsWith("denarde") -and $foldedLeafName.Contains("clinica") -and $foldedLeafName.Contains("fabio"))) {
    throw "ProjectRoot recusado. Pasta final encontrada: $leafName"
  }
  foreach ($required in @("server.js", "package.json", "ecosystem.config.cjs")) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $required))) {
      throw "ProjectRoot recusado. Arquivo essencial ausente: $required"
    }
  }
  return $root
}

function Convert-TimeToMinutes {
  param([Parameter(Mandatory)][string]$Time)
  $parts = $Time.Split(":")
  return ([int]$parts[0] * 60) + [int]$parts[1]
}

function Assert-OutsideProtectedWindow {
  param([datetime]$Now = (Get-Date), [int]$RequiredMarginMinutes = 20)
  $minutes = ($Now.Hour * 60) + $Now.Minute
  foreach ($window in $ProtectedWindows) {
    $start = Convert-TimeToMinutes $window["Start"]
    $end = Convert-TimeToMinutes $window["End"]
    if ($minutes -ge $start -and $minutes -le $end) {
      throw "Execução recusada dentro da janela protegida $($window["Label"])."
    }
  }
  $next = $ProtectedWindows |
    ForEach-Object { @{ Label = $_["Label"]; StartMinutes = Convert-TimeToMinutes $_["Start"] } } |
    Where-Object { $_["StartMinutes"] -gt $minutes } |
    Sort-Object StartMinutes |
    Select-Object -First 1
  if ($next -and (($next["StartMinutes"] - $minutes) -le $RequiredMarginMinutes)) {
    throw "Margem insuficiente antes da próxima janela protegida $($next["Label"])."
  }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(Mandatory)][string[]]$Arguments,
    [string]$LogPath
  )
  $line = "Executando: $Command $($Arguments -join ' ')"
  if ($LogPath) { Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8 }
  Write-Host $line
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $Command @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $output | ForEach-Object {
    if ($LogPath) { Add-Content -LiteralPath $LogPath -Value ([string]$_) -Encoding UTF8 }
    Write-Host $_
  }
  if ($exitCode -ne 0) {
    throw "Comando falhou: $Command $($Arguments -join ' ')"
  }
}

function Assert-PowerShellSyntax {
  param([Parameter(Mandatory)][string]$FilePath)
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($FilePath, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) {
    throw "Erro de sintaxe PowerShell em ${FilePath}: $($errors[0].Message)"
  }
}

function Assert-PowerShellHost {
  $version = $PSVersionTable.PSVersion
  Write-Host "PowerShell detectado: $($version.ToString())"
  if ($version.Major -lt 7) {
    throw "Host PowerShell incompatível. Use PowerShell 7+ com: pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\activate-whatsapp-robust-live.ps1 -ValidateOnly"
  }
}

function Assert-AdminReportConfig {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  $ecosystem = Join-Path $ProjectRoot "ecosystem.config.cjs"
  $adminMonitor = Join-Path $ProjectRoot "src\lib\whatsappAdminMonitor.js"
  $ecosystemContent = Get-Content -LiteralPath $ecosystem -Raw -Encoding UTF8
  $adminContent = Get-Content -LiteralPath $adminMonitor -Raw -Encoding UTF8

  if ($ecosystemContent -notmatch "WHATSAPP_ADMIN_REPORT_PHONE\s*:\s*'27999072659'") {
    throw "WHATSAPP_ADMIN_REPORT_PHONE ausente ou diferente do número administrativo autorizado."
  }
  if ($ecosystemContent -match "RoboClinicaScheduler[\s\S]*WHATSAPP_ADMIN_REPORT_PHONE") {
    throw "Scheduler não pode receber WHATSAPP_ADMIN_REPORT_PHONE."
  }
  if ($ecosystemContent -match "RoboClinicaWatchdog[\s\S]*WHATSAPP_ADMIN_REPORT_PHONE") {
    throw "Watchdog não pode receber WHATSAPP_ADMIN_REPORT_PHONE."
  }
  foreach ($pattern in @("WHATSAPP_ADMIN_MONITOR_PHONE", "98114", "0948")) {
    if ($adminContent -match $pattern) {
      throw "Referência administrativa antiga encontrada no código ativo do monitor."
    }
  }
}

function Get-ActivationPaths {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  $downloadRoot = "D:\Downloads"
  return @{
    LogDir = Join-Path $ProjectRoot "logs\activation"
    LockDir = Join-Path $ProjectRoot "logs\locks"
    BackupRoot = Join-Path $downloadRoot "ativacao-robo-whatsapp-2026-06-20"
    ReportPath = Join-Path $ProjectRoot "relatorios\ativacao-definitiva-robo-whatsapp-2026-06-20.md"
    GlobalLockPath = Join-Path $ProjectRoot "logs\locks\whatsapp-activation-global.lock"
    ActivationLockPath = Join-Path $ProjectRoot "logs\locks\ativacao-robo-whatsapp-2026-06-20.lock"
    LedgerPath = Join-Path $ProjectRoot "logs\audit\whatsapp-reminder-ledger.json"
  }
}

function New-ActivationLock {
  param(
    [Parameter(Mandatory)][string]$LockPath,
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$Stage
  )
  if (Test-Path -LiteralPath $LockPath) {
    $raw = Get-Content -LiteralPath $LockPath -Raw -ErrorAction SilentlyContinue
    $lock = $null
    try { $lock = $raw | ConvertFrom-Json } catch { $lock = $null }
    if ($lock -and $lock.pid) {
      $running = Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue
      if ($running) { throw "Lock ativo encontrado para PID $($lock.pid). Não será removido." }
    }
    if ($lock -and $lock.createdAt) {
      $age = (New-TimeSpan -Start ([datetime]$lock.createdAt) -End (Get-Date)).TotalMinutes
      if ($age -lt 60) { throw "Lock recente encontrado. Revisão manual necessária." }
    }
    Remove-Item -LiteralPath $LockPath -Force
  }
  $content = @{
    pid = $PID
    createdAt = (Get-Date).ToString("o")
    activationId = $ActivationId
    projectRoot = $ProjectRoot
    stage = $Stage
  } | ConvertTo-Json -Depth 4
  $stream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
  $stream.Write($bytes, 0, $bytes.Length)
  return $stream
}

function Set-ProcessModeInEcosystem {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][ValidateSet("sender", "scheduler", "watchdog")][string]$Role,
    [Parameter(Mandatory)][ValidateSet("disabled", "dry-run", "live")][string]$Mode
  )
  $ecosystem = Join-Path $ProjectRoot "ecosystem.config.cjs"
  $content = Get-Content -LiteralPath $ecosystem -Raw -Encoding UTF8
  $key = switch ($Role) {
    "sender" { "WHATSAPP_SENDER_MODE" }
    "scheduler" { "WHATSAPP_SCHEDULER_MODE" }
    "watchdog" { "WHATSAPP_WATCHDOG_MODE" }
  }
  $pattern = "$key\s*:\s*'[^']+'"
  if ($content -notmatch $pattern) { throw "Chave $key não encontrada no ecosystem.config.cjs." }
  $updated = $content -replace $pattern, "${key}: '$Mode'"
  $normalized = $updated.TrimEnd([char[]]@([char]13, [char]10)) + "`n"
  $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($ecosystem, $normalized, $utf8WithoutBom)
}

function ConvertFrom-Base64Utf8Json {
  param([Parameter(Mandatory)][string]$Encoded)
  $payload = $Encoded.Trim()
  if ([string]::IsNullOrWhiteSpace($payload) -or $payload -notmatch '^[A-Za-z0-9+/]+={0,2}$') {
    throw "Helper PM2 retornou payload Base64 inválido."
  }
  try {
    $bytes = [Convert]::FromBase64String($payload)
    $json = [System.Text.Encoding]::UTF8.GetString($bytes)
  } catch {
    throw "Falha ao decodificar o estado PM2 em Base64/UTF-8: $($_.Exception.Message)"
  }
  if (Test-CorruptedText $json) {
    throw "Estado PM2 sanitizado recusado por conter caracteres corrompidos."
  }
  return $json | ConvertFrom-Json
}

function Normalize-ComparablePath {
  param([Parameter(Mandatory)][string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Caminho vazio não pode ser comparado."
  }
  if (Test-CorruptedText $Value) {
    throw "Caminho recusado por conter caracteres corrompidos: $Value"
  }
  $fullPath = [System.IO.Path]::GetFullPath($Value)
  return $fullPath.TrimEnd([char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar))
}

function Assert-SameWindowsPath {
  param(
    [Parameter(Mandatory)][string]$Actual,
    [Parameter(Mandatory)][string]$Expected,
    [Parameter(Mandatory)][string]$Label
  )
  $actualNormalized = Normalize-ComparablePath $Actual
  $expectedNormalized = Normalize-ComparablePath $Expected
  if (-not [System.StringComparer]::OrdinalIgnoreCase.Equals($actualNormalized, $expectedNormalized)) {
    throw "$Label inesperado. Atual: $Actual | Esperado: $Expected"
  }
}

function Get-Pm2Snapshot {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  $helper = Join-Path $ProjectRoot "scripts\read-pm2-whatsapp-state.js"
  if (-not (Test-Path -LiteralPath $helper)) {
    throw "Helper PM2 sanitizado ausente: $helper"
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & node $helper --from-pm2 --base64 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "Helper PM2 sanitizado falhou: $($output -join [Environment]::NewLine)"
  }

  $encoded = ($output | ForEach-Object { [string]$_ }) -join ''
  $state = ConvertFrom-Base64Utf8Json -Encoded $encoded
  $stateJson = $state | ConvertTo-Json -Depth 20 -Compress
  if ($stateJson -match "27999072659|5527999072659|PRIVATE KEY|ACCESS_TOKEN|FIREBASE|SESSION|TOKEN|CREDENTIAL") {
    throw "Helper PM2 sanitizado retornou conteúdo sensível."
  }
  return @($state.processes)
}

function Assert-Pm2ReadonlyState {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  $snapshot = Get-Pm2Snapshot -ProjectRoot $ProjectRoot
  $robo = @($snapshot | Where-Object { $_.name -eq "RoboClinica" }) | Select-Object -First 1
  if ($robo) {
    $expectedServer = Join-Path $ProjectRoot "server.js"
    Assert-SameWindowsPath -Actual ([string]$robo.pm_exec_path) -Expected $expectedServer -Label "Script do RoboClinica no PM2"
    Assert-SameWindowsPath -Actual ([string]$robo.pm_cwd) -Expected $ProjectRoot -Label "Diretório de execução do RoboClinica no PM2"
    if (-not $robo.pid -or [int]$robo.pid -le 0) {
      throw "RoboClinica no PM2 está sem PID válido."
    }
    if ([string]$robo.status -ne "online") {
      throw "RoboClinica no PM2 não está online: $($robo.status)"
    }
    $adminMaskedProperty = $robo.PSObject.Properties["WHATSAPP_ADMIN_REPORT_PHONE_MASKED"]
    $adminMasked = if ($adminMaskedProperty) { $adminMaskedProperty.Value } else { "não presente no ambiente PM2 atual" }
    Write-Host "PM2 leitura segura: RoboClinica $($robo.status), PID $($robo.pid), reinícios $($robo.restart_time), admin $adminMasked"
  } else {
    throw "PM2 leitura segura: RoboClinica ausente."
  }
  $scheduler = @($snapshot | Where-Object { $_.name -eq "RoboClinicaScheduler" }) | Select-Object -First 1
  $watchdog = @($snapshot | Where-Object { $_.name -eq "RoboClinicaWatchdog" }) | Select-Object -First 1
  if ($scheduler) {
    $schedulerModeProperty = $scheduler.PSObject.Properties["WHATSAPP_SCHEDULER_MODE"]
    $schedulerMode = if ($schedulerModeProperty) { $schedulerModeProperty.Value } else { "não informado" }
    Write-Host "PM2 leitura segura: RoboClinicaScheduler presente em modo $schedulerMode."
  } else { Write-Host "PM2 leitura segura: RoboClinicaScheduler ausente." }
  if ($watchdog) {
    $watchdogModeProperty = $watchdog.PSObject.Properties["WHATSAPP_WATCHDOG_MODE"]
    $watchdogMode = if ($watchdogModeProperty) { $watchdogModeProperty.Value } else { "não informado" }
    Write-Host "PM2 leitura segura: RoboClinicaWatchdog presente em modo $watchdogMode."
  } else { Write-Host "PM2 leitura segura: RoboClinicaWatchdog ausente." }
}


function Wait-Pm2OperationalModes {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][ValidateSet("disabled", "dry-run", "live")][string]$ExpectedMode,
    [int]$TimeoutSeconds = 45
  )

  $definitions = @(
    @{ Name = "RoboClinica"; Role = "sender"; ModeKey = "WHATSAPP_SENDER_MODE"; Script = Join-Path $ProjectRoot "server.js" },
    @{ Name = "RoboClinicaScheduler"; Role = "scheduler"; ModeKey = "WHATSAPP_SCHEDULER_MODE"; Script = Join-Path $ProjectRoot "scripts\whatsapp-reminder-scheduler.js" },
    @{ Name = "RoboClinicaWatchdog"; Role = "watchdog"; ModeKey = "WHATSAPP_WATCHDOG_MODE"; Script = Join-Path $ProjectRoot "scripts\whatsapp-reminder-watchdog.js" }
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastReason = "estado ainda não consultado"

  do {
    try {
      $snapshot = Get-Pm2Snapshot -ProjectRoot $ProjectRoot
      $problems = @()

      foreach ($definition in $definitions) {
        $matches = @($snapshot | Where-Object { $_.name -eq $definition["Name"] })
        if ($matches.Count -ne 1) {
          $problems += "$($definition["Name"]): quantidade $($matches.Count)"
          continue
        }

        $processInfo = $matches[0]
        $modeProperty = $processInfo.PSObject.Properties[$definition["ModeKey"]]
        $roleProperty = $processInfo.PSObject.Properties["WHATSAPP_PROCESS_ROLE"]
        $mode = if ($modeProperty) { [string]$modeProperty.Value } else { "(ausente)" }
        $role = if ($roleProperty) { [string]$roleProperty.Value } else { "(ausente)" }

        if ([string]$processInfo.status -ne "online") {
          $problems += "$($definition["Name"]): status $($processInfo.status)"
        }
        if (-not $processInfo.pid -or [int]$processInfo.pid -le 0) {
          $problems += "$($definition["Name"]): PID inválido"
        }
        if ($mode -ne $ExpectedMode) {
          $problems += "$($definition["Name"]): modo $mode, esperado $ExpectedMode"
        }
        if ($role -ne $definition["Role"]) {
          $problems += "$($definition["Name"]): papel $role, esperado $($definition["Role"])"
        }

        Assert-SameWindowsPath -Actual ([string]$processInfo.pm_exec_path) -Expected ([string]$definition["Script"]) -Label "Script do $($definition["Name"])"
        Assert-SameWindowsPath -Actual ([string]$processInfo.pm_cwd) -Expected $ProjectRoot -Label "Diretório do $($definition["Name"])"
      }

      if ($problems.Count -eq 0) {
        Write-Host "PM2 confirmado: três processos online em modo $ExpectedMode."
        return
      }
      $lastReason = $problems -join "; "
    } catch {
      $lastReason = $_.Exception.Message
    }

    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)

  throw "PM2 não estabilizou em modo ${ExpectedMode}: $lastReason"
}

function Read-LedgerSnapshot {
  param([Parameter(Mandatory)][string]$LedgerPath)

  if (-not (Test-Path -LiteralPath $LedgerPath)) { return $null }

  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      return (Get-Content -LiteralPath $LedgerPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100)
    } catch {
      if ($attempt -eq 5) { throw }
      Start-Sleep -Milliseconds 400
    }
  }
}

function Get-OptionalObjectValue {
  param(
    [AllowNull()]$InputObject,
    [Parameter(Mandatory)][string]$Name
  )

  if ($null -eq $InputObject) { return $null }

  if ($InputObject -is [System.Collections.IDictionary]) {
    foreach ($key in $InputObject.Keys) {
      if ([string]::Equals([string]$key, $Name, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $InputObject[$key]
      }
    }
    return $null
  }

  $property = @(
    $InputObject.PSObject.Properties |
      Where-Object {
        [string]::Equals($_.Name, $Name, [System.StringComparison]::OrdinalIgnoreCase)
      } |
      Select-Object -First 1
  )

  if ($property.Count -eq 0) { return $null }
  return $property[0].Value
}

function Convert-ToOptionalUtcDate {
  param([AllowNull()]$Value)

  if ($null -eq $Value) { return $null }

  if ($Value -is [DateTimeOffset]) {
    return ([DateTimeOffset]$Value).ToUniversalTime()
  }

  if ($Value -is [DateTime]) {
    $dateTimeValue = [DateTime]$Value
    if ($dateTimeValue.Kind -eq [DateTimeKind]::Unspecified) {
      $dateTimeValue = [DateTime]::SpecifyKind($dateTimeValue, [DateTimeKind]::Local)
    }
    return ([DateTimeOffset]$dateTimeValue).ToUniversalTime()
  }

  $textValue = [string]$Value
  if ([string]::IsNullOrWhiteSpace($textValue)) { return $null }

  $parsed = [DateTimeOffset]::MinValue
  $roundtripStyles = [System.Globalization.DateTimeStyles]::AllowWhiteSpaces -bor
    [System.Globalization.DateTimeStyles]::RoundtripKind

  if (
    [DateTimeOffset]::TryParse(
      $textValue,
      [System.Globalization.CultureInfo]::InvariantCulture,
      $roundtripStyles,
      [ref]$parsed
    )
  ) {
    return $parsed.ToUniversalTime()
  }

  if (
    [DateTimeOffset]::TryParse(
      $textValue,
      [System.Globalization.CultureInfo]::CurrentCulture,
      [System.Globalization.DateTimeStyles]::AllowWhiteSpaces,
      [ref]$parsed
    )
  ) {
    return $parsed.ToUniversalTime()
  }

  return $null
}

function Get-OptionalCollectionValues {
  param([AllowNull()]$Value)

  if ($null -eq $Value) { return @() }
  if ($Value -is [System.Collections.IDictionary]) { return @($Value.Values) }
  if ($Value -is [System.Array]) { return @($Value) }

  $properties = @($Value.PSObject.Properties)
  if ($properties.Count -gt 0) {
    return @($properties | ForEach-Object { $_.Value })
  }

  return @($Value)
}

function Wait-LiveRuntimeEvidence {
  param(
    [Parameter(Mandatory)][string]$LedgerPath,
    [Parameter(Mandatory)][datetime]$StartedAt,
    [int]$TimeoutSeconds = 150
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $startedUtc = Convert-ToOptionalUtcDate -Value $StartedAt
  if ($null -eq $startedUtc) {
    throw "O horário inicial da ativação não pôde ser normalizado para UTC."
  }
  $lastReason = "ledger ainda sem evidência"

  do {
    $ledger = Read-LedgerSnapshot -LedgerPath $LedgerPath
    if ($ledger) {
      $heartbeats = @(Get-OptionalObjectValue -InputObject $ledger -Name "heartbeats")
      $senderReady = @(
        $heartbeats |
          Where-Object {
            $recordedAtUtc = Convert-ToOptionalUtcDate (Get-OptionalObjectValue -InputObject $_ -Name "recordedAt")
            (Get-OptionalObjectValue -InputObject $_ -Name "process") -eq "RoboClinica" -and
            (Get-OptionalObjectValue -InputObject $_ -Name "mode") -eq "live" -and
            (Get-OptionalObjectValue -InputObject $_ -Name "whatsappReady") -eq $true -and
            (Get-OptionalObjectValue -InputObject $_ -Name "qrBlocked") -ne $true -and
            (Get-OptionalObjectValue -InputObject $_ -Name "event") -eq "ready" -and
            $null -ne $recordedAtUtc -and
            $recordedAtUtc -ge $startedUtc
          } |
          Sort-Object {
            Convert-ToOptionalUtcDate (Get-OptionalObjectValue -InputObject $_ -Name "recordedAt")
          } -Descending |
          Select-Object -First 1
      )

      $schedulerLive = @(
        $heartbeats |
          Where-Object {
            $recordedAtUtc = Convert-ToOptionalUtcDate (Get-OptionalObjectValue -InputObject $_ -Name "recordedAt")
            (Get-OptionalObjectValue -InputObject $_ -Name "process") -eq "RoboClinicaScheduler" -and
            (Get-OptionalObjectValue -InputObject $_ -Name "mode") -eq "live" -and
            (Get-OptionalObjectValue -InputObject $_ -Name "schedulerRegistered") -eq $true -and
            $null -ne $recordedAtUtc -and
            $recordedAtUtc -ge $startedUtc
          } |
          Sort-Object {
            Convert-ToOptionalUtcDate (Get-OptionalObjectValue -InputObject $_ -Name "recordedAt")
          } -Descending |
          Select-Object -First 1
      )

      $watchdogLive = @(
        $heartbeats |
          Where-Object {
            $recordedAtUtc = Convert-ToOptionalUtcDate (Get-OptionalObjectValue -InputObject $_ -Name "recordedAt")
            (Get-OptionalObjectValue -InputObject $_ -Name "process") -eq "RoboClinicaWatchdog" -and
            (Get-OptionalObjectValue -InputObject $_ -Name "mode") -eq "live" -and
            $null -ne $recordedAtUtc -and
            $recordedAtUtc -ge $startedUtc
          } |
          Sort-Object {
            Convert-ToOptionalUtcDate (Get-OptionalObjectValue -InputObject $_ -Name "recordedAt")
          } -Descending |
          Select-Object -First 1
      )

      $checkpointContainer = Get-OptionalObjectValue -InputObject $ledger -Name "checkpoints"
      $watchdogCheckpoint = @(
        (Get-OptionalCollectionValues -Value $checkpointContainer) |
          Where-Object {
            $checkedAtUtc = Convert-ToOptionalUtcDate (Get-OptionalObjectValue -InputObject $_ -Name "checkedAt")
            (Get-OptionalObjectValue -InputObject $_ -Name "routine") -eq "WATCHDOG" -and
            $null -ne $checkedAtUtc -and
            $checkedAtUtc -ge $startedUtc
          } |
          Sort-Object {
            Convert-ToOptionalUtcDate (Get-OptionalObjectValue -InputObject $_ -Name "checkedAt")
          } -Descending |
          Select-Object -First 1
      )

      $incidentContainer = Get-OptionalObjectValue -InputObject $ledger -Name "incidents"
      $fatalIncidents = @(
        @($incidentContainer) |
          Where-Object {
            $recordedAtUtc = Convert-ToOptionalUtcDate (Get-OptionalObjectValue -InputObject $_ -Name "recordedAt")
            $incidentType = Get-OptionalObjectValue -InputObject $_ -Name "type"
            $null -ne $recordedAtUtc -and
            $recordedAtUtc -ge $startedUtc -and
            $incidentType -in @(
              "qr-blocked",
              "auth-failure",
              "whatsapp-disconnected",
              "whatsapp-initialize-error",
              "watchdog-check-error",
              "watchdog-self-check-error"
            )
          }
      )

      if (
        $senderReady.Count -gt 0 -and
        $schedulerLive.Count -gt 0 -and
        $watchdogLive.Count -gt 0 -and
        $watchdogCheckpoint.Count -gt 0 -and
        $fatalIncidents.Count -eq 0
      ) {
        Write-Host "Runtime confirmado: sender ready, scheduler live e watchdog operacional."
        return
      }

      $lastReason = "senderReady=$($senderReady.Count); schedulerLive=$($schedulerLive.Count); watchdogLive=$($watchdogLive.Count); watchdogCheckpoint=$($watchdogCheckpoint.Count); incidentesFatais=$($fatalIncidents.Count)"
    }

    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)

  throw "Runtime live não foi comprovado no prazo: $lastReason"
}

function Save-PreActivationBackup {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][hashtable]$Paths,
    [Parameter(Mandatory)]$OriginalPm2Snapshot
  )
  New-Item -ItemType Directory -Force -Path $Paths.BackupRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $ProjectRoot "ecosystem.config.cjs") -Destination (Join-Path $Paths.BackupRoot "ecosystem.config.cjs.bak") -Force
  $OriginalPm2Snapshot | ConvertTo-Json -Depth 20 | Out-File -FilePath (Join-Path $Paths.BackupRoot "pm2-original-sanitized.json") -Encoding UTF8
  & git diff -- server.js ecosystem.config.cjs package.json src/lib/whatsappReminderOperations.js src/lib/whatsappActivationSafety.js src/lib/whatsappReminderRuntime.js src/lib/whatsappAdminMonitor.js src/lib/whatsappPhone.js scripts/activate-whatsapp-robust-live.ps1 scripts/read-pm2-whatsapp-state.js scripts/whatsapp-reminder-scheduler.js scripts/whatsapp-reminder-watchdog.js tests/whatsapp-reminder-operations.test.mjs tests/whatsapp-activation-safety.test.mjs tests/whatsapp-admin-monitor.test.mjs tests/whatsapp-pm2-state.test.mjs |
    Out-File -FilePath (Join-Path $Paths.BackupRoot "whatsapp-robust.patch") -Encoding UTF8
}

function Invoke-SafeRollback {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][hashtable]$Paths,
    [Parameter(Mandatory)]$OriginalPm2Snapshot,
    [Parameter(Mandatory)][string]$Reason
  )
  $backupEcosystem = Join-Path $Paths.BackupRoot "ecosystem.config.cjs.bak"
  if (Test-Path -LiteralPath $backupEcosystem) {
    Copy-Item -LiteralPath $backupEcosystem -Destination (Join-Path $ProjectRoot "ecosystem.config.cjs") -Force
  }
  $current = Get-Pm2Snapshot -ProjectRoot $ProjectRoot
  $originalNames = @($OriginalPm2Snapshot | ForEach-Object { $_.name })

  $rollbackDefinitions = @(
    @{ Name = "RoboClinica"; Role = "sender"; ModeKey = "WHATSAPP_SENDER_MODE" },
    @{ Name = "RoboClinicaScheduler"; Role = "scheduler"; ModeKey = "WHATSAPP_SCHEDULER_MODE" },
    @{ Name = "RoboClinicaWatchdog"; Role = "watchdog"; ModeKey = "WHATSAPP_WATCHDOG_MODE" }
  )

  foreach ($definition in $rollbackDefinitions) {
    $originalProcess = @($OriginalPm2Snapshot | Where-Object { $_.name -eq $definition["Name"] }) | Select-Object -First 1
    if (-not $originalProcess) { continue }

    $modeProperty = $originalProcess.PSObject.Properties[$definition["ModeKey"]]
    $originalMode = if ($modeProperty) { [string]$modeProperty.Value } else { "disabled" }
    if ($originalMode -notin @("disabled", "dry-run", "live")) { $originalMode = "disabled" }

    Set-ProcessModeInEcosystem -ProjectRoot $ProjectRoot -Role $definition["Role"] -Mode $originalMode
  }
  foreach ($processName in @("RoboClinicaScheduler", "RoboClinicaWatchdog")) {
    $existsNow = $current | Where-Object { $_.name -eq $processName } | Select-Object -First 1
    if ($existsNow -and ($originalNames -notcontains $processName)) {
      Invoke-Checked "pm2" @("delete", $processName) (Join-Path $Paths.LogDir "ativacao-robo-whatsapp-2026-06-20.log")
    }
  }
  foreach ($processName in @("RoboClinica", "RoboClinicaScheduler", "RoboClinicaWatchdog")) {
    if ($originalNames -contains $processName) {
      Invoke-Checked "pm2" @("start", ".\ecosystem.config.cjs", "--only", $processName, "--update-env") (Join-Path $Paths.LogDir "ativacao-robo-whatsapp-2026-06-20.log")
    }
  }
  @"
# Falha na ativação definitiva

Motivo: $Reason
Rollback: modos operacionais anteriores restaurados; somente processos existentes anteriormente foram restaurados; processos novos removidos quando aplicável.
ClinicaFrontend: preservado.
pm2 save: não executado.
Mensagens: nenhuma mensagem de teste ou retroativa autorizada.
"@ | Out-File -FilePath $Paths.ReportPath -Encoding UTF8
}

function Invoke-ValidateOnly {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  Write-Host "ProjectRoot resolvido: $ProjectRoot"
  Write-Host "Caracteres corrompidos: ausentes"
  Assert-PowerShellSyntax $PSCommandPath
  Assert-PowerShellHost
  Push-Location -LiteralPath $ProjectRoot
  try {
    Invoke-Checked "node" @("--check", "server.js") $null
    Invoke-Checked "node" @("--check", "src\lib\whatsappReminderOperations.js") $null
    Invoke-Checked "node" @("--check", "src\lib\whatsappActivationSafety.js") $null
    Invoke-Checked "node" @("--check", "src\lib\whatsappReminderRuntime.js") $null
    Invoke-Checked "node" @("--check", "src\lib\whatsappPhone.js") $null
    Invoke-Checked "node" @("--check", "src\lib\whatsappAdminMonitor.js") $null
    Invoke-Checked "node" @("--check", "scripts\read-pm2-whatsapp-state.js") $null
    Invoke-Checked "node" @("--check", "scripts\check-whatsapp-architecture.mjs") $null
    Invoke-Checked "node" @("--check", "scripts\whatsapp-reminder-scheduler.js") $null
    Invoke-Checked "node" @("--check", "scripts\whatsapp-reminder-watchdog.js") $null
    Invoke-Checked "node" @("-e", "require('./ecosystem.config.cjs'); console.log('ecosystem ok')") $null
    Assert-AdminReportConfig -ProjectRoot $ProjectRoot
    Assert-Pm2ReadonlyState -ProjectRoot $ProjectRoot
    Invoke-Checked "npm" @("run", "test:wpp:offline") $null
    Invoke-Checked "npm" @("run", "check:wpp:architecture") $null
    Invoke-Checked "npm" @("run", "lint") $null
    Invoke-Checked "npm" @("run", "build") $null
    Invoke-Checked "git" @("diff", "--check") $null
  } finally {
    Pop-Location
  }
  Write-Host "ValidateOnly concluído sem alterar PM2, WhatsApp, Firebase, tarefas agendadas ou ecosystem."
}

function Invoke-Activation {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  Assert-OutsideProtectedWindow
  $paths = Get-ActivationPaths $ProjectRoot
  New-Item -ItemType Directory -Force -Path $paths.LogDir | Out-Null
  New-Item -ItemType Directory -Force -Path $paths.LockDir | Out-Null
  $logPath = Join-Path $paths.LogDir "ativacao-robo-whatsapp-2026-06-20.log"
  $lockStream = $null
  $globalLockStream = $null
  $originalPm2 = $null
  try {
    $lockStream = New-ActivationLock -LockPath $paths.ActivationLockPath -ProjectRoot $ProjectRoot -Stage "starting"
    $globalLockStream = New-ActivationLock -LockPath $paths.GlobalLockPath -ProjectRoot $ProjectRoot -Stage "global-transition"
    Push-Location -LiteralPath $ProjectRoot
    $originalPm2 = Get-Pm2Snapshot -ProjectRoot $ProjectRoot
    Save-PreActivationBackup -ProjectRoot $ProjectRoot -Paths $paths -OriginalPm2Snapshot $originalPm2
    Invoke-ValidateOnly -ProjectRoot $ProjectRoot

    Set-ProcessModeInEcosystem -ProjectRoot $ProjectRoot -Role sender -Mode "dry-run"
    Set-ProcessModeInEcosystem -ProjectRoot $ProjectRoot -Role scheduler -Mode "dry-run"
    Set-ProcessModeInEcosystem -ProjectRoot $ProjectRoot -Role watchdog -Mode "dry-run"
    Assert-OutsideProtectedWindow
    Invoke-Checked "pm2" @("start", ".\ecosystem.config.cjs", "--only", "RoboClinica,RoboClinicaScheduler,RoboClinicaWatchdog", "--update-env") $logPath
    Wait-Pm2OperationalModes -ProjectRoot $ProjectRoot -ExpectedMode "dry-run" -TimeoutSeconds 45
    $activationStartedAt = Get-Date

    Assert-OutsideProtectedWindow
    Set-ProcessModeInEcosystem -ProjectRoot $ProjectRoot -Role sender -Mode "live"
    Invoke-Checked "pm2" @("start", ".\ecosystem.config.cjs", "--only", "RoboClinica", "--update-env") $logPath

    Assert-OutsideProtectedWindow
    Set-ProcessModeInEcosystem -ProjectRoot $ProjectRoot -Role watchdog -Mode "live"
    Invoke-Checked "pm2" @("start", ".\ecosystem.config.cjs", "--only", "RoboClinicaWatchdog", "--update-env") $logPath

    Assert-OutsideProtectedWindow
    Set-ProcessModeInEcosystem -ProjectRoot $ProjectRoot -Role scheduler -Mode "live"
    Invoke-Checked "pm2" @("start", ".\ecosystem.config.cjs", "--only", "RoboClinicaScheduler", "--update-env") $logPath

    Wait-Pm2OperationalModes -ProjectRoot $ProjectRoot -ExpectedMode "live" -TimeoutSeconds 45
    Wait-LiveRuntimeEvidence -LedgerPath $paths.LedgerPath -StartedAt $activationStartedAt -TimeoutSeconds 150

    Assert-OutsideProtectedWindow
    if ($globalLockStream) { $globalLockStream.Close(); $globalLockStream = $null }
    Remove-Item -LiteralPath $paths.GlobalLockPath -Force -ErrorAction SilentlyContinue
    Assert-OutsideProtectedWindow
    Invoke-Checked "pm2" @("save") $logPath
  } catch {
    if ($originalPm2) {
      Invoke-SafeRollback -ProjectRoot $ProjectRoot -Paths $paths -OriginalPm2Snapshot $originalPm2 -Reason ($_.Exception.Message)
    }
    throw
  } finally {
    if ($globalLockStream) { $globalLockStream.Close() }
    if ($lockStream) { $lockStream.Close() }
    Remove-Item -LiteralPath $paths.GlobalLockPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $paths.ActivationLockPath -Force -ErrorAction SilentlyContinue
    Pop-Location -ErrorAction SilentlyContinue
  }
}

$projectRoot = Resolve-ProjectRoot

if ($ValidateOnly) {
  Invoke-ValidateOnly -ProjectRoot $projectRoot
} else {
  Invoke-Activation -ProjectRoot $projectRoot
}
