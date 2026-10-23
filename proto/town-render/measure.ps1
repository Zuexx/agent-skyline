# Memory of every process whose command line contains $Match (a browser's whole process tree shares
# its --user-data-dir): RAM (private working set) and GPU memory (dedicated + shared, from the
# Windows "GPU Process Memory" counters). Prints one JSON line.
param([Parameter(Mandatory = $true)][string]$Match)
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Match) -and $_.Name -ne 'powershell.exe' -and $_.Name -ne 'pwsh.exe' }
$ids = @($procs | ForEach-Object { [int]$_.ProcessId })
$ram = 0
foreach ($id in $ids) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) { $ram += $p.PrivateMemorySize64 }
}
$ded = 0; $sh = 0
foreach ($s in (Get-Counter '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction SilentlyContinue).CounterSamples) {
  if ($s.InstanceName -match '^pid_(\d+)_' -and $ids -contains [int]$Matches[1]) { $ded += $s.CookedValue }
}
foreach ($s in (Get-Counter '\GPU Process Memory(*)\Shared Usage' -ErrorAction SilentlyContinue).CounterSamples) {
  if ($s.InstanceName -match '^pid_(\d+)_' -and $ids -contains [int]$Matches[1]) { $sh += $s.CookedValue }
}
[pscustomobject]@{
  processes = $ids.Count
  ram_mb = [math]::Round($ram / 1MB, 1)
  gpu_dedicated_mb = [math]::Round($ded / 1MB, 1)
  gpu_shared_mb = [math]::Round($sh / 1MB, 1)
} | ConvertTo-Json -Compress
