# 検証記録

2026-10-18。実装対象のmain基点: `6a76662d738a48a4734adb1c7d9d8dddc5ae548a`。

## このセッションで実行済み
- V8実行環境でアプリinline JS、ml-background.js、ml-worker.jsの構文解析。
- `tests/ml-background.test.cjs` の全12テスト本体をV8上で実行し、12/12通過。Nodeのtest/assert相当のアダプターを使用したため、Nodeコマンド実行とは区別する。
- 公式モデルカード・ONNXファイル一覧・前処理設定・Apache-2.0・4.3.1の公式パイプラインソースを確認。
- Node 24で13テストを実行し13/13通過（`node tests/ml-background.test.cjs` および `node --test --test-isolation=none tests/ml-background.test.cjs`）。
- システムChromiumの実ブラウザで `tests/ml_browser.py` が通過。模擬マスクを使ったCanvas描画、前景/背景の画素、確認前再生防止、再生停止、PNG、JSON再読込、実MediaRecorder動画保存、モデル失敗/中止、動画非対応、録画エラー後の操作復帰を検査。
- `tests/browser_smoke.py` がpointer/touch fallbackの両ケースで通過。UIの高さ変更に合わせ、実タップ前にCanvasを表示領域へスクロールするようテストを補修。
- `git diff --check`、JS構文チェック、Pythonテストの構文チェックが通過。

## 自動実行用に追加
- Node標準testランナーによる13件。
- Chromium/WebKit上の模擬マスクによるCanvas/UI/保存E2E。
- 従来の手動輪郭・タッチフォールバック回帰テスト。
- GitHub Actionsワークフロー。CI結果は実際のrunを確認するまで成功とは扱わない。
- 実モデルを使う `tests/real_model_browser.py`。公式の人像fixtureでWorker→WASM推論→alpha受信まで確認する。ののの品質評価を代替しない。

## GitHub Actionsで確認済み
コード `67f53d4af940a4840edf91a9a91c8b8aac420e9e` に対する [run 39093088941](https://github.com/al1ce4869999999-ux/nono-animation/actions/runs/39093088941) が成功。Nodeの13件、Chromium、WebKit、手動pointer/touch fallback、**実際のTransformers.js 4.3.1 / Xenova/modnet / WASM推論**の全ステップが通過した。実モデル試験のfixtureは公式ドキュメントの人像であり、ののではない。

## 未検証・受入条件
クラウド環境起動後にNode/Chromiumの検証は実行できた。WebKitのブラウザ実体はこの環境に未インストール。Hugging Faceはクラウドの許可ホストに含まれないため、この環境で実モデルをダウンロードしていない。CI結果とiPhone実機の結果を区別する。

1. 実際のののの複雑な室内背景を含む代表画像と、髪・耳・手・しっぽの正解マスクでIoU/輪郭誤差と目視を評価する。モデルの数値的な棄却検査は意味の正しさを証明しない。
2. 透過前景で細部・半透明輪郭の保持、前景以外の混入を確認する。
3. 補完背景と最大振幅の動作を確認し、残像・二重表示・家具や模様のにじみを評価する。補完は簡易法であり、隠れた背景の正しい復元は保証しない。
4. iPhone Safari実機（OS/機種/空きメモリを記録）で初回ダウンロード、再試行、Worker/WASM、低メモリ、連続画像差し替え、PNG/MP4保存、バックグラウンド時中止を確認する。
5. 実モデルのダウンロードと推論をブラウザから通し、マスクの形状だけでなく、ののの外見と自然な見え方を評価する。

これらの検証前に「切り抜き成功」「iPhoneで動作確認済み」「完成」と判定しない。

メモリ対策として、モデル結果を受け取った時点でWorkerを終了し、その後に全解像度レイヤーを生成するよう修正。レイヤー確保失敗の異常系を13件目として追加し通過。
