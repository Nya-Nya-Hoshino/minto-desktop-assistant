# Continue TTS training and update the application

[English README](../README.en.md) · [日本語](TRAINING.ja.md) · [Public source repository](https://github.com/Nya-Nya-Hoshino/minto-desktop-assistant)

This guide describes the already prepared personal workspace at `D:\Desktop_Minto`. The source repository does not include its game audio, trained character weights, training virtual environment, or prepared dataset. Preserve those local files when updating application source. For a new dataset, use audio you are authorized to use and pair each clip with its exact transcript; do not infer transcripts from filenames.

## 0.2.0 joint-corpus workflow

The isolated joint corpus is `voice\MintoCorpusV020`: 967 training clips and 86 validation clips, totaling 79:58.648. All 52 previous validation clips remain held out. Training inputs and optimizer states are under `voice\Style-Bert-VITS2\Data\MintoV020`; inference outputs are under `voice\Style-Bert-VITS2\model_assets\MintoV020`. The original `Data\Minto` and its model outputs remain intact.

The 0.2.0 run resumed the original epoch-10 / step-9,960 optimizer state and completed five full traversals (epochs 10–14), ending at step 14,795. Its final inference file is `MintoV020_e14_s14795.safetensors`; final resumable states are `models\G_14795.pth`, `D_14795.pth`, and `WD_14795.pth`. The completed configuration has `train.epochs: 14`. The original inference weights, optimizer states and configuration were verified unchanged after this run.

The bundled 0.2.0 voice uses `MintoV020_e14_s14000.safetensors`: among the epoch-14 outputs it had the highest mean speaker-embedding cosine on six fixed holdouts (0.675229; old voice 0.636254; final step 14,795 voice 0.597477). All 120 outputs across the old voice and 11 new checkpoints passed signal checks. These small-sample scores do not prove improved pronunciation, prosody or laughter naturalness. The final step-14,795 states remain the resumption point; the deployed inference choice does not change them.

Back up the actual current `.pth` files and `config.json` before extending this run. Set `train.epochs` in `Data\MintoV020\config.json` to a larger **total** target, then run:

```powershell
Set-Location -LiteralPath 'D:\Desktop_Minto'
& '.\voice\train_minto_020.ps1' -Action Validate
& '.\voice\train_minto_020.ps1' -Action Train
```

The wrapper uses the isolated `voice\training-run-020` working directory. Its own `config.yml` and `configs\paths.yml` point to the new dataset/assets, so the official trainer's configuration-copy behavior does not overwrite the old JSON. The WavLM path in the training JSON is absolute. Keep this working directory with the local training workspace. The default action is validation; a saved epoch can be traversed again on resume.

It invokes the official trainer through `train_020.py` with `--not_use_custom_batch_sampler`: the older default bucket sampler skips very short or long clips. Validation confirms that the length-grouped sampler visits all 967 indices. `training_collate_020.py` pads only short batch tensors to the fixed segment length, preserving source WAVs and true audio/text lengths; this prevents fixed segment slices from exceeding the shortest utterance. Keep this wrapper when resuming the joint corpus.

`prepare_training_020.py` exposes explicit `resample`, `text`, `bert`, `styles`, and `validate` stages. Run it with the existing CUDA Python from the workspace, for example `& '.\voice\venv\Scripts\python.exe' '.\voice\prepare_training_020.py' validate`. WAV resampling keeps leading/trailing audio and does not trim or normalize it. The text stage preserves the audited split; default upstream preprocessing would re-split it. `bootstrap`, `all`, and `checkpoints` refuse to overwrite an existing new run. The Japanese worker is started from the upstream package directory before restoring the isolated configuration directory.

After training, run `voice\evaluation\evaluate_020.py` with the same CUDA Python. It compares the original deployed voice with every actual new inference checkpoint, using seed 42 and the same held-out/new sentences. Local listening WAVs and `comparison.json` go under `voice\evaluation\v020`. Signal checks and speaker embeddings cannot establish naturalness or correct intonation; listen to these samples before choosing your own checkpoint. For deployment, copy exactly one selected weight, its configuration and its training-only Neutral vector into a separate import folder. The application reads English names as Japanese katakana while preserving their display text; this does not provide native English speech.

The corpus, working directory, optimizer states, private comparison report and generated WAVs stay local and are excluded from the public source repository.

## Preserved 0.1.x training state

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
