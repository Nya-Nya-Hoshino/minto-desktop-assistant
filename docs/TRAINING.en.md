# Continue TTS training and update the application

[English README](../README.en.md) · [日本語](TRAINING.ja.md) · [Public source repository](https://github.com/Nya-Nya-Hoshino/minto-desktop-assistant)

This guide describes the already prepared personal workspace at `D:\Desktop_Minto`. The source repository does not include its game audio, trained character weights, training virtual environment, or prepared dataset. Preserve those local files when updating application source. For a new dataset, use audio you are authorized to use and pair each clip with its exact transcript; do not infer transcripts from filenames.

## Current training state

The selected corpus contains 997 training clips and 52 disjoint held-out clips, totaling 79:59.829. Training completed 10 epochs and 9,960 steps using JP-Extra, batch size 1, fp16. The trained model provides speaker `ミント` and style `Neutral`. The Neutral vector averages only the training clips.

The prepared inputs and resumable optimizer states are in `voice\Style-Bert-VITS2\Data\Minto`. Inference outputs are in `voice\Style-Bert-VITS2\model_assets\Minto`. `voice\evaluation\checkpoint_report.json` records the 1,000-, 5,000-, and 9,960-step comparison samples and their hashes.

## Resume manually

1. Exit the desktop assistant before copying or replacing any model files. Keep a separate backup of the current `config.json`, lists, and `Data\Minto\models\G_9960.pth`, `D_9960.pth`, `WD_9960.pth`.
2. Open `D:\Desktop_Minto\voice\Style-Bert-VITS2\Data\Minto\config.json`. Set `train.epochs` to the desired **total** number of epochs. For example, `15` means a total target of 15; it does not mean 15 additional epochs. The existing value is `10` because the first run has finished.
3. Validate the unchanged prepared corpus, then explicitly start training:

```powershell
Set-Location -LiteralPath 'D:\Desktop_Minto'
& '.\voice\train_minto.ps1' -Action Validate
& '.\voice\train_minto.ps1' -Action Train
```

`Validate` checks the exact 997/52 split and existing audio/BERT/style files without starting training. The wrapper uses `voice\venv\Scripts\python.exe`, UTF-8 output, and `USE_LIBUV=0` for the existing Windows setup. The official trainer restores its newest `G_*.pth`, `D_*.pth`, and `WD_*.pth` states. Its epoch loop resumes at the stored epoch and can traverse that epoch again; it does not restore an exact next-sample cursor.

`.pth` training states include optimizer information. A `.safetensors` inference checkpoint cannot replace them for equivalent resumption. The official `keep_ckpts: 1` setting removes older periodic optimizer snapshots, while inference checkpoints are retained every 500 steps and at completion. Keep backups before extending training.

The wrapper's default action is validation. Running it with the completed configuration is not a reason to train again. Do not rerun default `preprocess_text.py` or `preprocess_all.py` on the existing lists: they rewrite the partition and re-split the validation set from random samples, which destroys the fixed 997/52 split.

To regenerate only the existing WAV, BERT, and style caches from the processed official working directory:

```powershell
Set-Location -LiteralPath 'D:\Desktop_Minto\voice\Style-Bert-VITS2'
& '..\venv\Scripts\python.exe' 'resample.py' --sr 44100 --input_dir 'Data/Minto/raw' --output_dir 'Data/Minto/wavs' --num_processes 4
& '..\venv\Scripts\python.exe' 'bert_gen.py' --config 'Data/Minto/config.json'
& '..\venv\Scripts\python.exe' '..\generate_minto_styles.py'
```

The raw four-field text is in `esd_all.list`; the processed full text is in `all_cleaned.list`. For a different corpus, establish a traceable WAV-to-transcript pairing and a fixed partition first, then produce the official seven-field list; never infer transcripts from audio filenames.

## Choose a checkpoint through comparison

Additional steps do not establish a better voice. Generate identical ordinary held-out sentences and new assistant sentences for the checkpoints you wish to compare. Listen for missing/repeated words, Japanese pronunciation, long pauses, noise, naturalness, and character voice similarity. Include short and longer lines. Keep holdout recordings outside training and avoid using only lines heard during training.

The local `voice\evaluation\evaluate_checkpoints.py` reads exact held-out records and explicitly listed checkpoint filenames. Edit its `weights` list only after reading the new files present in `model_assets\Minto`; then run:

```powershell
& 'D:\Desktop_Minto\voice\venv\Scripts\python.exe' 'D:\Desktop_Minto\voice\evaluation\evaluate_checkpoints.py'
```

The script records WAV integrity, duration, amplitude, timing, and hashes. These do not prove correct pronunciation or speaker similarity. Current training loss is not held-out validation loss. Existing reports describe this limit and preserve the source transcripts.

## Apply the selected model without rebuilding

The recommended routine update uses the model import function, which leaves the built-in model and original training directory available for comparison.

1. While the assistant is closed, make a separate deployment folder containing **exactly one** selected `.safetensors` file, plus the matching `config.json` and `style_vectors.npy` from the same inference model directory. Do not select `model_assets\Minto` directly when it contains multiple checkpoint files.
2. Start the assistant, open voice settings, and import that deployment folder. The app copies the three files into its own `voice-models` data directory and automatically selects the imported model ID. That selection is saved across restarts.
3. Choose the speaker and style actually listed by the model. The current model supplies `ミント`/`Neutral`; do not enter invented style names. Save settings and test the voice connection.
4. Send a short Japanese test sentence and check audible output and mouth movement. Restart the app once to check that the imported model remains selected. Keep the previous model for rollback by selecting it again.

The source files remain untouched. Importing runs while the app is open because the app itself performs and validates that copy; manual copies or replacements require a fully closed app.

## Replace the bundled default or make a new distribution

For your local development checkout, the bundled model directory is `D:\Desktop_Minto\MintoAssistant\runtime\model_assets\Minto`. In a complete installed/portable distribution, it is the executable's `resources\runtime\model_assets\Minto`.

Exit the assistant and back up the entire target model directory. Replace its weight with your selected checkpoint and its matching `config.json` and `style_vectors.npy`. Keep exactly one `.safetensors` in that directory. The filename need not match the old weight: the adapter scans for the single `.safetensors`. Preserve the matching model configuration and vector file; copying a weight alone is not a complete update.

Restart, select the bundled model, and test new sentences. For a new installer/ZIP, update the development `runtime` first, then run `npm run build` from `D:\Desktop_Minto\MintoAssistant`. Test that rebuilt distribution with your selected model. Do not upload the character-derived weight, source game audio, or private configuration to the source repository.

The application runtime uses CPU PyTorch inference and accepts the supported Style-Bert-VITS2 `.safetensors` model format. Further GPU training stays in the separate CUDA training environment. `voice\requirements-runtime-lock.txt` records the installed embedded runtime packages; native DLLs, the embedded interpreter, OpenJTalk dictionary, and Japanese BERT still need to be preserved separately.

For application source updates, exit the app and back up the complete user data directory and excluded local assets/runtime before `git pull`. Restore your authorized `libs/live2dcubismcore.min.js`, character files, complete runtime, and source license archive before `npm ci`, `npm test`, and `npm run build`. Keep `D:\Desktop_Minto\voice` separately so a source update does not replace your dataset or optimizer states. See the README's update instructions for preserving installed user data or migrating the portable `data` directory.
