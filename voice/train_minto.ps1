param(
    [ValidateSet('Validate', 'Train')]
    [string]$Action = 'Validate'
)
$ErrorActionPreference = 'Stop'
$voiceRoot = $PSScriptRoot
$trainingRoot = Join-Path $voiceRoot 'Style-Bert-VITS2'
$pythonPath = Join-Path $voiceRoot 'venv\Scripts\python.exe'
$validationPath = Join-Path $voiceRoot 'evaluation\check_training_inputs.py'
foreach ($requiredPath in @($trainingRoot, $pythonPath, $validationPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Missing required path: $requiredPath" }
}
$env:PYTHONIOENCODING = 'utf-8'
$env:USE_LIBUV = '0'
& $pythonPath $validationPath
if ($LASTEXITCODE -ne 0) { throw 'Prepared training inputs failed validation.' }
if ($Action -eq 'Validate') { exit 0 }
Push-Location -LiteralPath $trainingRoot
try {
    & $pythonPath 'train_ms_jp_extra.py' '--config' 'Data/Minto/config.json' '--model' 'Data/Minto' '--skip_default_style' '--no_progress_bar'
    if ($LASTEXITCODE -ne 0) { throw "Training failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
