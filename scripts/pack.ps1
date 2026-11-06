# Pack dist\extension into dist\trucker-helper-v<version>.zip.
# Entry names are written with forward slashes. Compress-Archive on
# Windows PowerShell 5.1 writes backslashes, which Chrome/Brave read as a
# single file name like "_locales\en\messages.json" and then refuse to load.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'dist\extension'
$version = (Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json).version
$zip = Join-Path $root "dist\trucker-helper-v$version.zip"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zip) { Remove-Item $zip -Force }

$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $srcFull = (Resolve-Path $src).Path.TrimEnd('\') + '\'
  Get-ChildItem $src -Recurse -File | ForEach-Object {
    $name = $_.FullName.Substring($srcFull.Length).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $_.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $archive.Dispose()
}
Write-Host "Packed $zip"
