$ErrorActionPreference = "Stop"

$taskName = "NarraLume Bridge"
$workspace = Split-Path -Parent $PSScriptRoot
$bridgeEntry = Join-Path $workspace "apps\bridge\dist\main.js"
if (-not (Test-Path -LiteralPath $bridgeEntry)) {
  throw "Bridge build is missing. Run npm run build first."
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}"' -f $bridgeEntry) `
  -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Highest

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "NarraLume local provider bridge on 127.0.0.1:4320" `
  -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State
  LastTaskResult = $info.LastTaskResult
}
