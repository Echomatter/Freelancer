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
    $g.ScaleTransform(($size / 24.0), ($size / 24.0))
    $bg = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#183D32'))
    $route = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#F5F1D8'), 1.8)
    $route.StartCap = 'Round'; $route.EndCap = 'Round'; $route.LineJoin = 'Round'
    $tile = New-Object Drawing.Drawing2D.GraphicsPath
    $tile.AddArc(0, 0, 12, 12, 180, 90); $tile.AddArc(12, 0, 12, 12, 270, 90)
    $tile.AddArc(12, 12, 12, 12, 0, 90); $tile.AddArc(0, 12, 12, 12, 90, 90)
    $tile.CloseFigure()
    $g.FillPath($bg, $tile)
    # Use the same Route geometry as the sidebar and public SVG.
    $g.DrawEllipse($route, 3, 16, 6, 6)
    $g.DrawLine($route, 9, 19, 17.5, 19)
    $g.DrawArc($route, 14, 12, 7, 7, 90, -180)
    $g.DrawLine($route, 17.5, 12, 6.5, 12)
    $g.DrawArc($route, 3, 5, 7, 7, 90, 180)
    $g.DrawLine($route, 6.5, 5, 15, 5)
    $g.DrawEllipse($route, 15, 2, 6, 6)
    $stream = New-Object IO.MemoryStream
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $frames += ,@{ Size = $size; Bytes = $stream.ToArray() }
    if ($size -eq 256) { $bitmap.Save((Join-Path $assets 'freelancer.png'), [Drawing.Imaging.ImageFormat]::Png) }
    $stream.Dispose(); $tile.Dispose(); $route.Dispose(); $bg.Dispose(); $g.Dispose(); $bitmap.Dispose()
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
