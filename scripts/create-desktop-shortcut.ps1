[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $appRoot 'backend\.state\launcher'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Add-Type -AssemblyName System.Drawing
# Draw at each native icon size so the Freelancer route mark stays crisp.
$frames = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = New-Object Drawing.Bitmap($size, $size)
    $g = [Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = 'AntiAlias'
    $g.ScaleTransform(($size / 256.0), ($size / 256.0))
    $bg = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#183D32'))
    $gold = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#E7C879'))
    $light = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#F5F1D8'))
    $route = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#E7C879'), 15)
    $ring = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#75A58A'), 5)
    $g.FillEllipse($bg, 8, 8, 240, 240)
    $g.DrawEllipse($ring, 22, 22, 212, 212)
    # The route mark echoes Lucide's route icon: two endpoints connected by a
    # winding path, a compact visual shorthand for Freelancer orchestration.
    $g.DrawBezier($route, 70, 185, 138, 185, 106, 78, 182, 72)
    $g.FillEllipse($light, 40, 155, 52, 52)
    $g.FillEllipse($gold, 164, 48, 52, 52)
    $stream = New-Object IO.MemoryStream
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $frames += ,@{ Size = $size; Bytes = $stream.ToArray() }
    if ($size -eq 256) { $bitmap.Save((Join-Path $assets 'freelancer.png'), [Drawing.Imaging.ImageFormat]::Png) }
    $stream.Dispose(); $route.Dispose(); $ring.Dispose(); $bg.Dispose(); $gold.Dispose(); $light.Dispose(); $g.Dispose(); $bitmap.Dispose()
}
$iconPath = Join-Path $assets 'freelancer.ico'
$output = [IO.File]::Create($iconPath)
$writer = New-Object IO.BinaryWriter($output)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        $dimension = $frame.Size % 256
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
        $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
} finally { $writer.Dispose(); $output.Dispose() }
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath = Join-Path $desktop 'Freelancer.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'launch-chrome-app.vbs') + '"'
$shortcut.WorkingDirectory = $appRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Open Freelancer and keep its local server in the system tray.'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output $shortcutPath
