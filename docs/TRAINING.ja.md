# TTS 学習を続けてアプリに反映する

[日本語 README](../README.ja.md) · [English](TRAINING.en.md) · [公開ソースリポジトリ](https://github.com/Nya-Nya-Hoshino/minto-desktop-assistant)

この文書は、準備済みの個人用環境 `D:\Desktop_Minto` を対象にしています。ソースリポジトリにはゲーム音声、学習済みキャラクター重み、学習用仮想環境、処理済みデータセットを含めません。アプリのソースを更新する際も、それらのローカルファイルは保持してください。新しいデータセットでは、利用権のある音声と正確な原文を対応づけ、ファイル名から台詞を推測しないでください。

## 現在の学習状態

選択した音声は学習用 997 本と、それと重複しない留出用 52 本です。合計時間は 79 分 59.829 秒です。JP-Extra、batch size 1、fp16 で 10 epoch、9,960 step の学習を完了しています。話者は `ミント`、スタイルは `Neutral` です。Neutral の平均ベクトルには学習用音声だけを使っています。

準備済みデータと再開用の最適化状態は `voice\Style-Bert-VITS2\Data\Minto`、推論用の出力は `voice\Style-Bert-VITS2\model_assets\Minto` にあります。`voice\evaluation\checkpoint_report.json` には 1,000・5,000・9,960 step の比較音声とハッシュを記録しています。

## 手動で再開する

1. モデルファイルをコピー・置換する前にデスクトップアシスタントを終了します。現在の `config.json`、リスト、`Data\Minto\models\G_9960.pth`、`D_9960.pth`、`WD_9960.pth` を別の場所にバックアップします。
2. `D:\Desktop_Minto\voice\Style-Bert-VITS2\Data\Minto\config.json` を開き、`train.epochs` を目標の**総 epoch 数**に変更します。例えば `15` は合計 15 epoch を意味し、15 epoch の追加ではありません。現在は初回学習が完了したため `10` です。
3. 準備済みの分区を検証してから、明示的に学習を開始します。

```powershell
Set-Location -LiteralPath 'D:\Desktop_Minto'
& '.\voice\train_minto.ps1' -Action Validate
& '.\voice\train_minto.ps1' -Action Train
```

`Validate` は 997/52 の正確な分区と音声・BERT・style ファイルを確認し、学習を起動しません。ラッパーは既存の `voice\venv\Scripts\python.exe`、UTF-8 出力、Windows 環境用の `USE_LIBUV=0` を使用します。公式学習器は最新の `G_*.pth`、`D_*.pth`、`WD_*.pth` を読み込みます。保存された epoch からループを再開するため、その epoch のデータを再度走査する場合があります。次のサンプル位置まで厳密に復元する方式ではありません。

`.pth` の学習状態には最適化情報があります。推論用 `.safetensors` だけでは同等の学習再開はできません。公式の `keep_ckpts: 1` 設定は古い定期的な最適化状態を削除します。推論用重みは 500 step ごとと完了時に保持します。学習を延長する前にバックアップしてください。

ラッパーの既定動作は検証です。完了済みの設定で再学習する必要はありません。また、既存のリストに既定の `preprocess_text.py` や `preprocess_all.py` を再実行しないでください。これらは分区を書き換え、ランダム抽出で検証セットを再分割するため、固定した 997/52 の留出分区が壊れます。

処理済みの公式作業ディレクトリで、既存の WAV・BERT・style キャッシュだけを再生成する場合:

```powershell
Set-Location -LiteralPath 'D:\Desktop_Minto\voice\Style-Bert-VITS2'
& '..\venv\Scripts\python.exe' 'resample.py' --sr 44100 --input_dir 'Data/Minto/raw' --output_dir 'Data/Minto/wavs' --num_processes 4
& '..\venv\Scripts\python.exe' 'bert_gen.py' --config 'Data/Minto/config.json'
& '..\venv\Scripts\python.exe' '..\generate_minto_styles.py'
```

原文の 4 列テキストは `esd_all.list`、公式処理後の全文は `all_cleaned.list` にあります。別のコーパスを使う場合は、まず出所の追える WAV と原文の対応および固定分区を確立し、そのうえで公式の 7 列リストを生成してください。音声ファイル名からテキストを推測してはいけません。

## 比較して重みを選ぶ

step が増えるだけでは音声が改善した証拠になりません。比較する重みに対して同じ日常の留出台詞と、新しいアシスタントの文章を生成します。単語の抜け・繰り返し、日本語の読み、長い間、雑音、自然さ、キャラクターらしい声を聞き比べてください。短文と長文の両方を含め、学習中に使った文だけで判断しないでください。

ローカルの `voice\evaluation\evaluate_checkpoints.py` は正確な留出リストと明示した重み名を読みます。`model_assets\Minto` に実際に生成されたファイルを確認してから、その `weights` リストを変更し、実行します。

```powershell
& 'D:\Desktop_Minto\voice\venv\Scripts\python.exe' 'D:\Desktop_Minto\voice\evaluation\evaluate_checkpoints.py'
```

このスクリプトは WAV の形式、時間、振幅、処理時間、ハッシュを記録します。それだけでは正確な発音や話者の類似度は証明できません。現在記録している学習損失は留出検証損失ではありません。既存の評価文書にはその制限と原文を保持しています。

## 再ビルドせず選んだモデルを使う

通常の更新にはモデル取り込みを使います。同梱モデルと元の学習フォルダーを残したまま比較できます。

1. アプリを終了した状態で、別の配備フォルダーに選んだ `.safetensors` **1 個だけ**と、同じ推論モデルの `config.json`、`style_vectors.npy` をコピーします。複数の重みがある `model_assets\Minto` 全体を直接取り込まないでください。
2. アプリを起動して音声設定を開き、その配備フォルダーを取り込みます。3 ファイルをユーザーデータの `voice-models` にコピーし、取り込んだモデル ID を自動で選択します。選択は再起動後も保存されます。
3. モデルに実際にある話者とスタイルを選びます。現在のモデルは `ミント`/`Neutral` です。存在しないスタイル名を追加せず、設定を保存して接続テストを実行します。
4. 短い日本語を送信し、音声と口の動きを確認します。一度再起動して、モデルの選択が維持されることも確認します。以前のモデルは選び直して戻せるよう保持します。

元のモデルファイルは変更しません。取り込み操作自体はアプリがコピーと検証を行うため起動中に実行します。手作業でのコピー・置換は完全に終了してから行ってください。

## 同梱の既定モデルや配布物を更新する

ローカルの開発環境では、同梱モデルの保存先は `D:\Desktop_Minto\MintoAssistant\runtime\model_assets\Minto` です。完成済みのインストール・ポータブル版では、EXE の `resources\runtime\model_assets\Minto` にあります。

アプリを終了して対象フォルダー全体をバックアップします。選んだ重みと、対応する `config.json`、`style_vectors.npy` に置き換え、`.safetensors` が 1 個だけになるようにします。アダプターは単一の `.safetensors` を列挙するため、重みのファイル名を旧モデルと合わせる必要はありません。重みだけのコピーでは更新が完了しません。対応する設定とベクトルも必要です。

再起動して同梱モデルを選び、新しい文章で確認します。新しいインストーラー・ZIP を作る場合は開発環境の `runtime` を更新してから、`D:\Desktop_Minto\MintoAssistant` で `npm run build` を実行します。作成した配布物でも選んだモデルを確認してください。キャラクター由来の重み、ゲーム原音声、非公開設定をソースリポジトリへアップロードしないでください。

アプリの音声環境は CPU PyTorch 推論で、対応する Style-Bert-VITS2 の `.safetensors` を使用します。GPU での追加学習は別の CUDA 環境で行います。`voice\requirements-runtime-lock.txt` は組み込み環境のパッケージを記録しますが、DLL、組み込み Python、OpenJTalk 辞書、日本語 BERT は別途保持する必要があります。

アプリのソースを更新する際は、終了してからユーザーデータ全体と除外するローカル素材・音声環境をバックアップし、その後で `git pull` を実行します。利用権のある `libs/live2dcubismcore.min.js`、キャラクターファイル、完全な音声環境、ソースのライセンスアーカイブを復元してから `npm ci`、`npm test`、`npm run build` を実行します。ソース更新でデータセットや最適化状態が置き換わらないよう、`D:\Desktop_Minto\voice` は別途保持します。インストール版のユーザーデータ保持やポータブル版の `data` の移行は README の更新手順を参照してください。
