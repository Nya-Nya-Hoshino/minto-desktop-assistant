# Third-party components

MintoAssistant adapts [OpenDesktop-Pet](https://github.com/HanLoney/OpenDesktop-Pet), copyright 2025 Loney, under Apache-2.0. The original `LICENSE` and `NOTICE` are preserved inside the application archive.

The Live2D Cubism Core library is governed by the Live2D proprietary software license; the bundled PixiJS and Live2D integration retain their respective original notices. Game character artwork, Live2D models, dialogue, and the derived voice model remain subject to their original rights. They are provided here for the owner's requested personal study.

The local voice engine includes [Style-Bert-VITS2](https://github.com/litagin02/Style-Bert-VITS2), upstream commit `66de777e06392c0f313600be03c43ef96658b244`. The complete upstream source archive is shipped at `resources/runtime/licenses/Style-Bert-VITS2-source.zip`; the actual inference source and local adapter are also provided directly at `resources/runtime/style_bert_vits2` and `resources/runtime/voice_server.py`. License texts are in `resources/runtime/licenses`. Those license texts govern the voice engine independently of the desktop application's Apache-2.0 license.

The runtime includes Python, PyTorch, NumPy, SciPy, Transformers and their dependencies. Distribution metadata and associated license files remain in `resources/runtime/python/Lib/site-packages`; Python's `LICENSE.txt` and the upstream Japanese BERT model files are retained in the runtime. Build-only Electron Builder, Sharp and png-to-ico are excluded from the application.

Japanese BERT is [ku-nlp/deberta-v2-large-japanese-char-wwm](https://huggingface.co/ku-nlp/deberta-v2-large-japanese-char-wwm), by Kyoto University NLP. Its official model card is included beside the unchanged weights in `resources/runtime/bert/deberta-v2-large-japanese-char-wwm/README.md`. It is licensed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/); the [full legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en) defines the license terms.

This is a local personal-study build and is not a grant to redistribute the game assets or trained character voice.
