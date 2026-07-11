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

function Draw-Mark($g) {
  $leafBrush = New-Object System.Drawing.SolidBrush($GREEN)
  $berryBrush = New-Object System.Drawing.SolidBrush($RED)
  Draw-Leaf $g 40 23 11 5.6 -28 $leafBrush
  Draw-Leaf $g 60 23 11 5.6 28 $leafBrush
  $circles = @(@(39,45,12),@(61,45,12),@(50,42,12),@(35,60,12),@(65,60,12),@(50,58,13),@(42,73,11),@(58,73,11),@(50,80,9))
  foreach ($c in $circles) { $g.FillEllipse($berryBrush, [single]($c[0]-$c[2]), [single]($c[1]-$c[2]), [single]($c[2]*2), [single]($c[2]*2)) }
  $pen = New-Object System.Drawing.Pen($WHITE, 6)
  $pen.StartCap='Round'; $pen.EndCap='Round'
  $g.DrawLine($pen, [single]50, [single]44.5, [single]50, [single]57)
  $g.DrawArc($pen, [single](50-13), [single](61-13), [single]26, [single]26, 320, 260)
}

function RoundRectPath([single]$x, [single]$y, [single]$rw, [single]$rh, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x+$rw-$d, $y, $d, $d, 270, 90)
  $p.AddArc($x+$rw-$d, $y+$rh-$d, $d, $d, 0, 90); $p.AddArc($x, $y+$rh-$d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}

$w = 880; $h = 240
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)

$card = RoundRectPath 2 2 ($w-4) ($h-4) 44
$cardBrush = New-Object System.Drawing.SolidBrush($BG)
$g.FillPath($cardBrush, $card)
$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,41,46,54), 2)
$g.DrawPath($borderPen, $card)

# mark (drawn in 0..100 space, scaled to 168px, vertically centered)
$markSize = 168.0
$mx = 52.0; $my = ($h - $markSize) / 2.0
$state = $g.Save()
$g.TranslateTransform([single]$mx, [single]$my)
$g.ScaleTransform([single]($markSize/100.0), [single]($markSize/100.0))
Draw-Mark $g
$g.Restore($state)

$font = New-Object System.Drawing.Font('Segoe UI', 58, [System.Drawing.FontStyle]::Bold, 'Pixel')
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,245,247,250))
$g.DrawString('PiWake', $font, $white, 236, 48)
$tagFont = New-Object System.Drawing.Font('Segoe UI', 19, [System.Drawing.FontStyle]::Regular, 'Pixel')
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,141,150,165))
$g.DrawString('Wake your home, from anywhere.', $tagFont, $muted, 242, 152)

$g.Dispose()
$bmp.Save('E:\Coding\PiWake\docs\logo.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output 'logo written'
