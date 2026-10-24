param(
  [Parameter(Mandatory = $true)][string]$ExtensionId
)

$node = (Get-Command node -ErrorAction Stop).Source
$destination = Join-Path $env:LOCALAPPDATA 'XMediaDownloader\native-host'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'x-media-eagle-host.js') $destination -Force
$launcher = Join-Path $destination 'x-media-eagle-host.cmd'
@"
@echo off
"$node" "%~dp0x-media-eagle-host.js"
"@ | Set-Content -LiteralPath $launcher -Encoding ASCII
$manifest = @{ name = 'com.x_media_downloader.eagle'; description = 'X Media Downloader local Eagle importer'; path = $launcher; type = 'stdio'; allowed_origins = @("chrome-extension://$ExtensionId/") } | ConvertTo-Json
$manifestPath = Join-Path $destination 'com.x_media_downloader.eagle.json'
Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding UTF8
$key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.x_media_downloader.eagle'
New-Item -Force -Path $key | Out-Null
Set-ItemProperty -Path $key -Name '(Default)' -Value $manifestPath
Write-Host "已安装 Native Messaging 助手：$manifestPath"
