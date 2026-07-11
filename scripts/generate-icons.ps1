Add-Type -AssemblyName System.Drawing
$BG = [System.Drawing.Color]::FromArgb(255,11,13,16)
$RED = [System.Drawing.Color]::FromArgb(255,240,68,84)
$GREEN = [System.Drawing.Color]::FromArgb(255,66,214,138)
$WHITE = [System.Drawing.Color]::White

function Draw-Leaf($g, [single]$cx, [single]$cy, [single]$rx, [single]$ry, [single]$deg, $brush) {
  $state = $g.Save()
  $g.TranslateTransform($cx, $cy)
  $g.RotateTransform($deg)
  $g.FillEllipse($brush, -$rx, -$ry, $rx*2, $ry*2)
  $g.Restore($state)
}

function Draw-Mark($g, $berryColor, $leafColor, $glyphMode) {
  $leafBrush = New-Object System.Drawing.SolidBrush($leafColor)
  $berryBrush = New-Object System.Drawing.SolidBrush($berryColor)
  Draw-Leaf $g 40 23 11 5.6 -28 $leafBrush
  Draw-Leaf $g 60 23 11 5.6 28 $leafBrush
  $circles = @(@(39,45,12),@(61,45,12),@(50,42,12),@(35,60,12),@(65,60,12),@(50,58,13),@(42,73,11),@(58,73,11),@(50,80,9))
  foreach ($c in $circles) { $g.FillEllipse($berryBrush, [single]($c[0]-$c[2]), [single]($c[1]-$c[2]), [single]($c[2]*2), [single]($c[2]*2)) }
  if ($glyphMode -eq 'white' -or $glyphMode -eq 'erase') {
    if ($glyphMode -eq 'erase') {
      $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(0,0,0,0), 6)
    } else {
      $pen = New-Object System.Drawing.Pen($WHITE, 6)
    }
    $pen.StartCap='Round'; $pen.EndCap='Round'
    $g.DrawLine($pen, [single]50, [single]44.5, [single]50, [single]57)
    $g.DrawArc($pen, [single](50-13), [single](61-13), [single]26, [single]26, 320, 260)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  }
}

function RoundRectPath([single]$x, [single]$y, [single]$rw, [single]$rh, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x+$rw-$d, $y, $d, $d, 270, 90)
  $p.AddArc($x+$rw-$d, $y+$rh-$d, $d, $d, 0, 90); $p.AddArc($x, $y+$rh-$d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}

function New-Icon([int]$size, [string]$out, [string]$mode, [double]$fraction) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  if ($mode -eq 'boxed') {
    $path = RoundRectPath 0 0 $size $size ([single]($size*0.24))
    $brush = New-Object System.Drawing.SolidBrush($BG)
    $g.FillPath($brush, $path)
  } elseif ($mode -eq 'fullbleed') {
    $brush = New-Object System.Drawing.SolidBrush($BG)
    $g.FillRectangle($brush, 0, 0, $size, $size)
  }
  $scale = [single]($size * $fraction / 100.0)
  $offset = [single]($size * (1 - $fraction) / 2.0)
  $g.TranslateTransform($offset, $offset)
  $g.ScaleTransform($scale, $scale)
  if ($mode -eq 'mono') { Draw-Mark $g $WHITE $WHITE 'erase' }
  else { Draw-Mark $g $RED $GREEN 'white' }
  $g.Dispose()
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "wrote $out"
}

$pub = 'E:\Coding\PiWake\public'
$mas = 'E:\Coding\PiWake\mobile\assets'
New-Icon 192 "$pub\icon-192.png" 'boxed' 1.0
New-Icon 512 "$pub\icon-512.png" 'boxed' 1.0
New-Icon 512 "$pub\icon-maskable-512.png" 'fullbleed' 0.72
New-Icon 180 "$pub\apple-touch-icon.png" 'fullbleed' 0.78
New-Icon 1024 "$mas\icon.png" 'fullbleed' 0.76
New-Icon 1024 "$mas\android-icon-foreground.png" 'transparent' 0.52
New-Icon 1024 "$mas\android-icon-monochrome.png" 'mono' 0.52
New-Icon 512 "$mas\splash-icon.png" 'transparent' 0.85
New-Icon 48 "$mas\favicon.png" 'boxed' 1.0
$bmp = New-Object System.Drawing.Bitmap(1024,1024)
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear($BG); $g.Dispose()
$bmp.Save("$mas\android-icon-background.png",[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
Write-Output 'all icons regenerated'
