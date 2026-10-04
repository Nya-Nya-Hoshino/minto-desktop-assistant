# TTS 学習を続けてアプリに反映する

[日本語 README](../README.ja.md) · [English](TRAINING.en.md) · [公開ソースリポジトリ](https://github.com/Nya-Nya-Hoshino/minto-desktop-assistant)

この文書は、準備済みの個人用環境 `D:\Desktop_Minto` を対象にしています。ソースリポジトリにはゲーム音声、学習済みキャラクター重み、学習用仮想環境、処理済みデータセットを含めません。アプリのソースを更新する際も、それらのローカルファイルは保持してください。新しいデータセットでは、利用権のある音声と正確な原文を対応づけ、ファイル名から台詞を推測しないでください。

## 0.2.0 の統合コーパスで学習を続ける

統合コーパスは `voice\MintoCorpusV020` にあり、学習用 967 本、留出用 86 本、合計 79 分 58.648 秒です。以前の留出音声 52 本をすべて保持しています。学習入力と最適化状態は `voice\Style-Bert-VITS2\Data\MintoV020`、推論出力は `voice\Style-Bert-VITS2\model_assets\MintoV020` にあります。以前の `Data\Minto` とそのモデル出力は保持します。

0.2.0 の学習は以前の epoch 10・step 9,960 の最適化状態から再開し、epoch 10～14 の 5 回の全件走査を完了、step 14,795 で終了しました。最終推論ファイルは `MintoV020_e14_s14795.safetensors`、再開用状態は `models\G_14795.pth`、`D_14795.pth`、`WD_14795.pth` です。完了した設定の値は `train.epochs: 14` です。以前の推論重み・最適化状態・設定が変更されていないことを、終了後にハッシュで確認しています。

0.2.0 の同梱音声には `MintoV020_e14_s14000.safetensors` を使用します。epoch 14 の出力のうち、固定した留出 6 文の平均話者埋め込み cosine が最も高かったためです（0.675229、旧音声 0.636254、最終 step 14,795 の音声 0.597477）。旧音声と新しい重み 11 個から生成した 120 本は信号検査を通過しました。この少数のスコアだけで発音・イントネーション・笑い声の自然さの改善を証明することはできません。学習再開は最終 step 14,795 の状態から行い、推論重みの選択はその状態を変更しません。

続行前に、実際にある `.pth` と `config.json` をバックアップします。`Data\MintoV020\config.json` の `train.epochs` を、より大きい**総 epoch 数**に変更してから実行します。

```powershell
Set-Location -LiteralPath 'D:\Desktop_Minto'
& '.\voice\train_minto_020.ps1' -Action Validate
& '.\voice\train_minto_020.ps1' -Action Train
```

ラッパーは独立した `voice\training-run-020` を作業ディレクトリとして使用します。専用の `config.yml` と `configs\paths.yml` が新しい入力・出力を指すため、公式学習器の設定コピーで古い JSON を上書きしません。学習 JSON の WavLM 保存先は絶対パスです。この作業ディレクトリも学習環境と一緒に保持してください。既定の動作は検証で、再開時には保存済みの epoch をもう一度走査する場合があります。

`train_020.py` を通して公式学習器に `--not_use_custom_batch_sampler` を渡します。古い既定の bucket sampler は極端に短い・長い音声を除外するためです。検証では length-grouped sampler が 967 本すべてのインデックスを走査することを確認します。`training_collate_020.py` は短いバッチのテンソルだけを固定区間長までゼロ埋めし、元の WAV と実際の音声・テキスト長を保持します。最短音声で固定区間を切り出す際の範囲外アクセスを防ぐため、統合コーパスの続行でもこのラッパーを使用してください。

`prepare_training_020.py` の個別 stage は `resample`、`text`、`bert`、`styles`、`validate` です。既存の CUDA Python から、例えば `& '.\voice\venv\Scripts\python.exe' '.\voice\prepare_training_020.py' validate` と実行します。重サンプリング時に語頭・語尾を切り落とさず、音量の正規化もしません。text stage は監査済み分区を保持します。公式の既定前処理は分区を書き換えるため使わないでください。`bootstrap`、`all`、`checkpoints` は既存の新しい実行環境の上書きを拒否します。日本語処理 worker は上流パッケージのディレクトリから起動し、その後で独立した設定ディレクトリへ戻ります。

学習後、同じ CUDA Python で `voice\evaluation\evaluate_020.py` を実行します。以前の音声と、実際に生成されたすべての新しい推論重みを同じ留出台詞・新しい文章で比較します。各文章の seed は 42 です。試聴 WAV と `comparison.json` は `voice\evaluation\v020` に保存します。信号の検査や話者埋め込みでは自然さやイントネーションを証明できないため、自分で重みを選ぶときは試聴してください。取り込み用の別フォルダーには選んだ重み 1 個と対応する設定、学習音声だけで計算した Neutral ベクトルをコピーします。アプリは英語名の表示を保ちながらカタカナで読みます。英語の母語発音には対応しません。

コーパス、独立した作業ディレクトリ、最適化状態、比較レポート、生成 WAV はローカルに保持し、公開ソースには含めません。

## 保持した 0.1.x の学習状態

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
