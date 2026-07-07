# Tải ffmpeg / ffprobe / yt-dlp về thư mục bin/ của dự án.
# Chạy: npm run fetch-bins  (hoặc powershell -File scripts/fetch-binaries.ps1)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$bin = Join-Path (Split-Path $PSScriptRoot -Parent) 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

$yt = Join-Path $bin 'yt-dlp.exe'
if (-not (Test-Path $yt)) {
  Write-Host '>> Downloading yt-dlp.exe ...'
  Invoke-WebRequest 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $yt -UseBasicParsing
  Write-Host '   yt-dlp OK'
} else { Write-Host '   yt-dlp already present' }

if (-not (Test-Path (Join-Path $bin 'ffmpeg.exe'))) {
  Write-Host '>> Downloading ffmpeg (gyan.dev release-essentials) ...'
  $zip = Join-Path $env:TEMP 'ffmpeg-release-essentials.zip'
  Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip -UseBasicParsing
  $dst = Join-Path $env:TEMP ('ffx_' + [guid]::NewGuid().ToString('N'))
  Expand-Archive -Path $zip -DestinationPath $dst -Force
  Get-ChildItem -Recurse -Path $dst -Include ffmpeg.exe, ffprobe.exe | ForEach-Object {
    Copy-Item $_.FullName $bin -Force
  }
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host '   ffmpeg/ffprobe OK'
} else { Write-Host '   ffmpeg already present' }

Write-Host 'DONE'
