$listeners = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($pidNum in $listeners) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pidNum"
  Write-Output ("PID " + $pidNum + ": " + $proc.CommandLine)
  if ($proc.CommandLine -like '*dev-server*') {
    Stop-Process -Id $pidNum -Force
    Write-Output ("killed " + $pidNum)
  }
}
$all = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*dev-server*' }
foreach ($p in $all) {
  Write-Output ("dev-server pid " + $p.ProcessId + " (not listening on 4000)")
  Stop-Process -Id $p.ProcessId -Force
  Write-Output ("killed " + $p.ProcessId)
}
Write-Output "---done---"
