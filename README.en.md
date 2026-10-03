# MintoAssistant

[Source repository](https://github.com/Nya-Nya-Hoshino/minto-desktop-assistant)

[日本語](README.ja.md) · [English](README.en.md) · [TTS training and model updates](docs/TRAINING.en.md)

[Source repository](https://github.com/Nya-Nya-Hoshino/minto-desktop-assistant) — public.

A Windows x64 desktop companion with two Live2D outfits, Japanese dialogue, local Style-Bert-VITS2 speech, mouse tracking, screen understanding, and persistent conversation saves.

The source repository contains the application code and documentation. Copyrighted character models, original game audio, the character-derived voice checkpoint, proprietary Cubism Core, private settings, conversation saves, and development caches are excluded. `assets/skins.json` contains model metadata; the persona configuration retains rewritten facts and speech rules, without original game dialogue examples. A local personal-use distribution may contain assets supplied by its owner; cloning the source repository does not provide those assets or a ready-made Python/model runtime.

## Run a local distribution

For the installer edition, run `MintoAssistant-Setup-0.1.0-windows-x64.exe` and select an installation directory. Installation is for the current Windows user.

For the portable edition, extract the complete ZIP into a writable directory and run `MintoAssistant.exe`. Keep `portable.flag`, `resources`, and all DLLs together with the executable. Portable user data is stored in its adjacent `data` directory.

Click the character to open the translucent chat bubble and input box. Drag the character to move it; use the mouse wheel to resize it. Gaze follows the desktop mouse pointer, including positions outside the character window. Existing model motions provide expressions, poses, hand movement, and ear movement; generated audio drives lip synchronization.

Right-click the character or tray icon for the menu. Double-click the tray icon to open settings. Choose the interface language in settings: Chinese, English, or Japanese. The interface language does not change the character's Japanese dialogue and speech; Chinese input is supported.

## Configure dialogue and vision

Configure dialogue and vision separately with the provider, API base URL, exact model ID, and your API key. The application appends `/chat/completions` to the base URL. Use the provider's actual OpenAI-compatible endpoint; image input must be supported by the selected vision model. Provider choices include DeepSeek, OpenAI, Gemini, Grok, and a custom compatible service.

Use the connection test after saving. The locally verified DeepSeek configuration is base URL `https://api.deepseek.com`, model ID `deepseek-flash`, and reasoning effort `high`. This describes a tested configuration rather than a promise that a provider will keep a model indefinitely. API keys are encrypted with Windows storage; source and release packages do not include development credentials.

Reply text is Japanese. The application validates the structured reply and its expression/pose mapping before displaying it. Invalid output or service failure is reported in the interface.

## Screen observation

Choose the display in settings. A chat message can include the current screen, and the standalone screen action can describe it without typing a message. Periodic observation checks every 60 seconds by default. Proactive speech has a minimum interval of 120 seconds; it is skipped during another request, audio playback, screen lock, unchanged content, or when the vision result says there is nothing suitable to discuss. Pause observation from settings or the tray menu.

Screenshots are sent to the configured vision provider for the current request. Conversation saves retain observation summaries and timestamps, not screenshot files.

## Voice models

A complete local distribution starts and stops its bundled CPU speech service automatically. An external Style-Bert-VITS2 service can also be selected using its actual HTTP base URL.

To use your own model, import a folder containing exactly one `.safetensors` checkpoint, `config.json`, and `style_vectors.npy`. The files are copied into the application data directory; the source folder is preserved. Select the speaker and style from the metadata the model actually supplies. The existing Mint checkpoint supplies speaker `ミント` and style `Neutral`.

[Continue local training and deploy a new checkpoint](docs/TRAINING.en.md) explains total epochs, resumable training states, held-out comparisons, importing a selected checkpoint, and updating the bundled default model.

## Conversation saves

Create, rename, switch, export, import, or delete independent saves in settings. Each save retains the full conversation, its long-term summary, and its outfit. Limiting the context sent to the model does not delete stored history. Switching saves cancels active requests and audio. Save exports exclude provider settings and API keys.

Installed applications use the current user's application data directory. Settings show the precise path and provide an action to open it. Exit the application before copying the whole data directory for backup. Encrypted API keys belong to the Windows user environment and should be configured again on another computer.

## Develop and build on Windows

Install a Node.js/npm environment. The app uses Electron 44.3.0. Development data goes into `_data`. Supply the following local inputs **before** running the installation, test, startup, or build commands below; tests inspect the actual model files and fail when those files are absent.

Before starting or packaging, supply the local character files expected by `assets/skins.json` under `assets/minto`, together with the character configuration. For a different model, adapt the motion/parameter mapping to identifiers verified from that model. Source checkout alone cannot render the excluded character assets.

Restore the proprietary Cubism Core JavaScript from your existing authorized local copy to the exact path `libs/live2dcubismcore.min.js`. It is excluded from GitHub; the model files and registry metadata do not replace this runtime library.

Provide a complete licensed local inference runtime under `runtime`. One way to reuse your existing personal distribution is to copy its complete `resources/runtime` directory there while the application is closed. This directory contains the embedded Python, dependencies, OpenJTalk dictionary, Japanese BERT, the voice adapter, model assets, and license files. Keep their relative paths intact. Copy `resources/runtime/licenses/Style-Bert-VITS2-source.zip` to `build/Style-Bert-VITS2-source.zip` if rebuilding from that distribution. The dependency lock in the local training workspace records pip versions; it does not replace the embedded interpreter, native DLLs, dictionaries, or model weights.

Once these local inputs are supplied, run from the source checkout:

```powershell
npm ci
npm test
npm start
```

Exit the running development app before building:

```powershell
npm run build
npm run package:audit
```

The build produces an installer and portable ZIP in `dist`; `dist/SHA256SUMS.txt` records release hashes. `npm run build:portable` builds only the ZIP. Provider credentials, user saves, training audio, optimizer checkpoints, test data, and caches are excluded from packaging. Interface localization and English/Japanese documentation are included by the release configuration.

## Update application source or a local distribution

Exit the app and back up its full data directory before updating. Settings show the exact data path; the portable edition uses the `data` folder beside the executable. Also keep backups of your excluded local inputs: `assets/minto`, `libs/live2dcubismcore.min.js`, and the complete `runtime` directory. Keep the training workspace separately.

In your GitHub source checkout, run `git pull`. Restore or verify those local inputs and the required `build/Style-Bert-VITS2-source.zip`, then run `npm ci`, `npm test`, and `npm run build`. A source update does not download the excluded character files or trained voice weights.

For the installer edition, run the rebuilt installer as the same Windows user and keep the backed-up application data. For the portable edition, close the old app, extract the new ZIP into a separate writable directory, and copy the backed-up `data` folder into that new directory before starting it. Preserve the entire data folder, including imported voice models, rather than copying only conversation exports. Keep the original backup until saves, settings, and voice playback have been checked in the new version.

The inherited Apache-2.0 `LICENSE` and `NOTICE` are retained. Component notices are in `THIRD_PARTY_NOTICES.md` in a distribution and the runtime license directory. Style-Bert-VITS2 source and its AGPL license accompany the voice runtime. Character assets retain their original rights and are not included in the source repository.
