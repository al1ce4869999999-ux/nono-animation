# のののアニメ工房 (Nono Motion Studio)

無料・ブラウザ内処理のイラスト編集ツール。AIによる全身抽出候補と、手動で囲んだパーツのアニメーションを扱います。画像を外部の推論APIへ送信せず、有料API・キー・ユーザーのPC作業は不要です。

**品質検証は未完了です。** MODNetは人像向けで、ののや動物キャラクターの全身・髪・耳・手・しっぽの意味を保証しません。数値検査の通過を「切り抜き成功」と表示せず、自動再生もしません。

## 使い方
1. HTTPSで公開されたページをiPhone Safari等で開き、画像を選びます。初回はjsDelivrからライブラリ・WASM、Hugging Faceからモデルをダウンロードします。
2. 端末内のWorkerで前景マスクを推論します。読込進捗を表示し、中止できます。
3. 候補の透過前景と補完背景を確認します。髪・耳・手・しっぽの欠けや背景残り、補完のにじみを確認してください。二つの確認欄をチェックした場合だけ再生できます。
4. 再生中は全身を一枚の透過レイヤーとして微小に上下・左右・回転させます。速度・揺れ幅で調整できます。変形や描き足しはしません。
5. 違和感があれば停止し「元画像に戻す」を使います。停止中は編集用の元画像をそのまま表示します。
6. PNG、対応ブラウザでの動画、制作JSONを保存できます。手動の輪郭選択・付け根・複数パーツ・シーン文章のキーワード解析も残しています。

旧来の色判定による自動全身抽出・しっぽ候補探索・タップ領域選択はアプリから呼び出しません。「AIで全身を抽出」は同じAI処理を再試行します。旧 `body-extractor.js` は互換履歴用の未使用ファイルで、ページからは読み込みません。

## 実装
- `ml-worker.js`: Transformers.js **4.3.1** のbundled ESMを固定URLから読み込み、`pipeline("background-removal", "Xenova/modnet", {device:"wasm", dtype:"fp32"})` を実行。出力RGBAのalphaを前景マスクとして返します。RGBは元絵から複製します。
- `ml-background.js`: Worker制御、マスク形式・面積・透明度・画像端・動作余白の棄却検査、透過レイヤー、背景補完、微小動作波形。
- 背景補完は長辺256pxで、前景alphaの最大値を縮小マスクへ集約し、微細な毛先も補完元から除外します。周囲3pxを含む領域を最近傍背景色で埋め、穴の中だけ16回拡散します。全解像度では除去領域を不透明な補完画素で置換し、元キャラクターを重ね戻しません。領域外の背景は維持します。
- 全身動作の最大値は短辺の左右0.6%・上下0.9%、回転約0.69度。通常の揺れ幅15ではその1/3です。推論はフレームごとには実行しません。
- 180秒のタイムアウト、中止、画像変更、失敗、完了時にWorkerを破棄。モデルもdisposeします。同時に複数の推論は実行しません。
- シングルスレッドWASMでWebGPU・SharedArrayBuffer・COOP/COEPに依存しない構成です。Safari実機互換性は未検証です。
- 入力は25MB/24メガピクセルまで。新規画像は長辺1280pxの編集用コピーへ縮小します。元のアップロードファイルを書き換えません。保存解像度は編集用コピーの解像度です。AI抽出は縦横比3以内に制限し、前処理の極端なメモリ増大を避けます。
- モデルのfp32 ONNX重みは公式一覧で約25.9MBです。WASM・ライブラリ等は別途必要で、実行メモリはダウンロードサイズより大きくなります。キャッシュはブラウザ任せで、オフライン動作を保証しません。

## 保存・互換性
- PNGは再生中の全身フレームを保存し、停止中は元画像を保存します。
- 動画はCanvas captureStreamとMediaRecorderが対応するMP4/WebMを選択します。非対応時は理由を表示します。画面が非表示になると録画を中止します。録画中は画像差し替え等を無効化します。
- 制作JSON v2は元の編集画像・前景alpha PNG・手動パーツ・動作設定・文章を保持します。全身データを開くと再び輪郭・補完背景の確認を要求します。旧v1も読めます。旧データの大きな画像は手動編集に対応しますがAI抽出の上限は1280pxです。
- 制作JSONには画像が含まれます。共有時には内容を確認してください。

## 検証と限界
`tests/ml-background.test.cjs` は12件の正常・異常系テストです。空/全塗り/過度に曖昧/端切れ/余白不足/不正なマスク、alphaの保持、二重表示の原因となる前景の補完元混入、背景領域の不変、動作範囲、失敗・再試行・中止・タイムアウト・転送失敗・入力上限を検査します。

`tests/ml_browser.py` は**決定的な模擬マスク**を使い、Canvas実描画、候補確認、再生停止、前景/背景の画素、PNG、JSON再読込、動画の対応分岐、モデル失敗と中止を検査します。`tests/browser_smoke.py` は従来の手動選択・タッチフォールバック・再生停止の回帰テストです。GitHub ActionsでChromium/WebKitを対象に実行します。WebKitもiPhone実機の代わりにはなりません。

開発者用実行例（アプリ利用者の環境構築は不要）:
```sh
node --test tests/ml-background.test.cjs
pip install playwright==1.58.0
python -m playwright install --with-deps chromium webkit
python tests/ml_browser.py
BROWSER=webkit python tests/ml_browser.py
python tests/browser_smoke.py
```

実際の実行結果と未検証項目は [TESTING.md](TESTING.md) に記録します。

`tests/real_model_browser.py` は公式の人像fixtureと実モデルを使うネットワーク統合スモークです。モデルの推論実行を確認するもので、ののの外見・複雑な室内背景の品質試験ではありません。

特に、複雑な室内の裏側の家具・模様を復元する機能はありません。補完はにじみや繰返しを生じます。モデルが見落とした前景は背景に残りえます。髪や耳が欠けても数値だけでは検知できないため、品質確認で候補を拒否してください。不確実な画像は元画像のままにし、手動編集を選べます。**実際ののの画像・正解マスクでの精度、自然な見え方、iPhone実機での速度/発熱/メモリ/保存は未検証です。**

## 公式資料・利用条件（2026-10-18確認）
- [Transformers.js 4.3.1 release](https://github.com/huggingface/transformers.js/releases/tag/4.3.1)
- [4.3.1 BackgroundRemovalPipeline実装](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/src/pipelines/background-removal.js): 入力が単一画像ならRGBA RawImageを返します。モデルカード内の古い配列形式の例と区別しています。
- [Xenova/modnetモデルカード](https://huggingface.co/Xenova/modnet): background-removal・fp32の例、Apache-2.0、人像マッティング用途。
- [ONNXモデル一覧](https://huggingface.co/Xenova/modnet/tree/main/onnx)、[前処理設定](https://huggingface.co/Xenova/modnet/blob/main/preprocessor_config.json): ONNX形式、shortest_edge 512、32の倍数、平均/標準偏差0.5。
- [MODNet公式](https://github.com/ZHKKKe/MODNet)、[Apache-2.0ライセンス](https://github.com/ZHKKKe/MODNet/blob/master/LICENSE)
- [ONNX Runtime Web環境設定](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)

ライブラリとモデルは無料の公開配布物を参照します。画像の推論APIは使用せず、モデルやブラウザの保証を追加するものではありません。配布元の利用条件・ライセンスを遵守してください。本番ホスティング設定・有料枠は変更しません。
