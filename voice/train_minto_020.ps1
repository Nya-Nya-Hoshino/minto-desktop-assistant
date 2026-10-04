param([ValidateSet('Validate','Train')][string]$Action='Validate')
$ErrorActionPreference='Stop'
$voiceRoot=$PSScriptRoot
$pythonPath=Join-Path $voiceRoot 'venv\Scripts\python.exe'
$trainingRoot=Join-Path $voiceRoot 'Style-Bert-VITS2'
$runRoot=Join-Path $voiceRoot 'training-run-020'
$configPath=Join-Path $trainingRoot 'Data\MintoV020\config.json'
$dataPath=Join-Path $trainingRoot 'Data\MintoV020'
$scriptPath=Join-Path $voiceRoot 'train_020.py'
$env:PYTHONIOENCODING='utf-8'
$env:USE_LIBUV='0'
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
& $pythonPath (Join-Path $voiceRoot 'prepare_training_020.py') 'validate'
if($LASTEXITCODE -ne 0){throw 'The isolated training inputs failed validation.'}
if($Action -eq 'Validate'){exit 0}
Push-Location -LiteralPath $runRoot
try {
    & $pythonPath $scriptPath '--config' $configPath '--model' $dataPath '--skip_default_style' '--no_progress_bar' '--not_use_custom_batch_sampler'
    if($LASTEXITCODE -ne 0){throw "Training failed: $LASTEXITCODE"}
} finally {Pop-Location}
