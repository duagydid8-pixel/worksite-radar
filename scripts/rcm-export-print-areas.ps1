param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir,

  [double]$Scale = 2.0
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

function Release-ComObject($Object) {
  if ($null -ne $Object -and [System.Runtime.InteropServices.Marshal]::IsComObject($Object)) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($Object)
  }
}

function ConvertTo-SafeFileName([string]$Name) {
  $invalid = [System.IO.Path]::GetInvalidFileNameChars()
  $safe = $Name
  foreach ($char in $invalid) {
    $safe = $safe.Replace($char, "_")
  }
  return $safe.Trim()
}

function Get-CellText($Worksheet, [int]$Row, [int]$Column) {
  $cell = $null
  try {
    $cell = $Worksheet.Cells.Item($Row, $Column)
    return ([string]$cell.Text).Trim()
  } finally {
    Release-ComObject $cell
  }
}

function Hide-RcmZeroEmployeeRows($Worksheet, $Range) {
  $sheetName = [string]$Worksheet.Name
  if ($sheetName -notmatch "^#(2|3)\b") {
    return 0
  }

  $nameHeaderTexts = @(
    "$([char]0xC774)$([char]0xB984)",
    "$([char]0xC131)$([char]0xBA85)",
    "$([char]0xC0AC)$([char]0xC6A9)$([char]0xC790)"
  )
  $employeeNoHeaderTexts = @(
    "$([char]0xC0AC)$([char]0xBC88)",
    "$([char]0xC0AC)$([char]0xC6D0)$([char]0xBC88)$([char]0xD638)"
  )

  $firstRow = [int]$Range.Row
  $lastRow = $firstRow + [int]$Range.Rows.Count - 1
  $firstColumn = [int]$Range.Column
  $lastColumn = $firstColumn + [int]$Range.Columns.Count - 1
  $headerRow = $null

  for ($row = $firstRow; $row -le [Math]::Min($lastRow, $firstRow + 80); $row++) {
    for ($column = $firstColumn; $column -le $lastColumn; $column++) {
      $cellText = Get-CellText $Worksheet $row $column
      if ($cellText -in $nameHeaderTexts) {
        $headerRow = $row
        break
      }
    }
    if ($null -ne $headerRow) {
      break
    }
  }

  if ($null -eq $headerRow) {
    return 0
  }

  $nameColumn = $null
  $employeeNoColumn = $null
  for ($column = $firstColumn; $column -le $lastColumn; $column++) {
    $text = Get-CellText $Worksheet $headerRow $column
    if ($text -in $nameHeaderTexts) {
      $nameColumn = $column
    }
    if ($text -in $employeeNoHeaderTexts) {
      $employeeNoColumn = $column
    }
  }

  if ($null -eq $nameColumn) {
    return 0
  }

  $hiddenRows = 0
  for ($row = $headerRow + 1; $row -le $lastRow; $row++) {
    $nameText = Get-CellText $Worksheet $row $nameColumn
    $employeeNoText = if ($null -ne $employeeNoColumn) { Get-CellText $Worksheet $row $employeeNoColumn } else { "0" }
    if (($nameText -eq "0" -or $nameText -eq "0.0") -and ($employeeNoText -eq "0" -or $employeeNoText -eq "0.0")) {
      $rowObject = $null
      try {
        $rowObject = $Worksheet.Rows.Item($row)
        $rowObject.Hidden = $true
        $hiddenRows++
      } finally {
        Release-ComObject $rowObject
      }
    }
  }

  return $hiddenRows
}

function Find-LastContentRow($Worksheet, [int]$StartRow, [int]$StartColumn, [int]$OriginalRowCount, [int]$ColumnCount) {
  $maxRow = $StartRow + $OriginalRowCount - 1
  for ($row = $maxRow; $row -ge $StartRow; $row--) {
    for ($column = $StartColumn; $column -lt ($StartColumn + $ColumnCount); $column++) {
      $text = Get-CellText $Worksheet $row $column
      if (![string]::IsNullOrWhiteSpace($text)) {
        return $row
      }
    }
  }
  return $StartRow
}

function Export-RcmRangeImage($Worksheet, $Range, [string]$DisplayName, [string]$OutputDir, [double]$Scale) {
  $safeName = ConvertTo-SafeFileName $DisplayName
  $outputPath = Join-Path $OutputDir "$safeName.png"
  $chartObject = $null
  $chart = $null

  try {
    $Worksheet.Activate() | Out-Null
    $Range.Select() | Out-Null

    $width = [Math]::Max(200, [double]$Range.Width)
    $height = [Math]::Max(100, [double]$Range.Height)
    $exportWidth = [Math]::Round($width * $Scale, 2)
    $exportHeight = [Math]::Round($height * $Scale, 2)

    $Range.CopyPicture(2, -4147) | Out-Null
    Start-Sleep -Milliseconds 250

    $chartObject = $Worksheet.ChartObjects().Add(0, 0, $exportWidth, $exportHeight)
    $chartObject.Activate() | Out-Null
    $chart = $chartObject.Chart
    $chart.Paste() | Out-Null
    Start-Sleep -Milliseconds 250
    $chart.Export($outputPath, "PNG") | Out-Null

    if (!(Test-Path -LiteralPath $outputPath)) {
      throw "PNG export failed: $DisplayName"
    }

    $fileInfo = Get-Item -LiteralPath $outputPath
    return [PSCustomObject]@{
      sheetName = $DisplayName
      range = $Range.Address($false, $false)
      fileName = "$safeName.png"
      path = $outputPath
      size = $fileInfo.Length
      widthPoints = $exportWidth
      heightPoints = $exportHeight
    }
  } finally {
    if ($null -ne $chartObject) {
      try { $chartObject.Delete() | Out-Null } catch {}
    }
    Release-ComObject $chart
    Release-ComObject $chartObject
  }
}

if (!(Test-Path -LiteralPath $InputPath)) {
  throw "Input file not found: $InputPath"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$excel = $null
$workbook = $null
$results = @()

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false

  $workbook = $excel.Workbooks.Open($InputPath, 3, $true)

  foreach ($worksheet in $workbook.Worksheets) {
    $sheetName = [string]$worksheet.Name
    if ($sheetName -notmatch "^#(2|3|4|5|6|7)\b") {
      Release-ComObject $worksheet
      continue
    }

    $printArea = [string]$worksheet.PageSetup.PrintArea
    if ([string]::IsNullOrWhiteSpace($printArea)) {
      $usedRange = $worksheet.UsedRange
      $printArea = $usedRange.Address($true, $true)
      Release-ComObject $usedRange
    }

    $rangeText = ($printArea -split ",")[0]
    $range = $worksheet.Range($rangeText)
    $originalStartRow = [int]$range.Row
    $originalStartColumn = [int]$range.Column
    $originalRowCount = [int]$range.Rows.Count
    $originalColumnCount = [int]$range.Columns.Count
    Hide-RcmZeroEmployeeRows $worksheet $range | Out-Null
    try {
      if ($sheetName -match "^#4\b") {
        $startRow = [int]$range.Row
        $startColumn = [int]$range.Column
        $rowCount = [int]$range.Rows.Count
        $columnCount = [int]$range.Columns.Count
        $partCount = 3
        $splitRowCount = [Math]::Ceiling($rowCount / $partCount)
        $lastColumn = $startColumn + $columnCount - 1

        for ($partIndex = 0; $partIndex -lt $partCount; $partIndex++) {
          $partStartRow = $startRow + ($splitRowCount * $partIndex)
          if ($partStartRow -gt ($startRow + $rowCount - 1)) {
            continue
          }
          $partEndRow = [Math]::Min($partStartRow + $splitRowCount - 1, $startRow + $rowCount - 1)
          $partRange = $null
          try {
            $partRange = $worksheet.Range(
              $worksheet.Cells.Item($partStartRow, $startColumn),
              $worksheet.Cells.Item($partEndRow, $lastColumn)
            )
            $partLabel = "#4-$($partIndex + 1) "
            $results += Export-RcmRangeImage $worksheet $partRange ($sheetName -replace "^#4\s*", $partLabel) $OutputDir $Scale
          } finally {
            Release-ComObject $partRange
          }
        }
      } else {
        $results += Export-RcmRangeImage $worksheet $range $sheetName $OutputDir $Scale
      }
    } finally {
      Release-ComObject $range
    }

    Release-ComObject $worksheet
  }

  $results | ConvertTo-Json -Depth 4 -Compress
} finally {
  if ($null -ne $workbook) {
    $workbook.Close($false) | Out-Null
  }
  if ($null -ne $excel) {
    $excel.Quit() | Out-Null
  }
  Release-ComObject $workbook
  Release-ComObject $excel
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
