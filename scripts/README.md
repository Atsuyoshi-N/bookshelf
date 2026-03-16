# Kindle CSV インポートスクリプト

Amazonのデータエクスポートから取得したCSVファイルを `data/books.json` に変換するスクリプトです。

## 1. Amazonからデータをリクエスト

1. [Amazon データリクエストページ](https://www.amazon.co.jp/hz/privacy-central/data-requests/preview.html) にアクセス
2. **「Kindle」** カテゴリを選択してリクエストを送信
3. 確認メールが届くのでリンクをクリック
4. **数日後**にダウンロードリンク付きのメールが届く

## 2. CSVファイルを取得

ダウンロードしたZIPを展開し、以下の2ファイルを取り出します。

| ファイル | 内容 |
|---------|------|
| `Kindle.Devices.ReadingSession.csv` | 読書セッション（日時・読書時間・ページめくり数） |
| `Kindle.KindleDocs.DocumentMetadata.csv` | 書籍メタデータ（タイトル等） |

### ReadingSession.csv のカラム

| カラム | 内容 |
|--------|------|
| `ASIN` | 本の識別子 |
| `start_timestamp` | セッション開始日時 |
| `total_reading_millis` | 読書時間（ミリ秒） |
| `number_of_page_flips` | めくったページ数 |
| `device_family` | デバイス種別 |
| `content_type` | コンテンツ種別 |

## 3. スクリプトを実行

```bash
# 新規作成（既存の books.json を上書き）
node scripts/import-kindle-csv.mjs \
  --sessions path/to/Kindle.Devices.ReadingSession.csv \
  --metadata path/to/Kindle.KindleDocs.DocumentMetadata.csv

# 既存の books.json に追記
node scripts/import-kindle-csv.mjs \
  --sessions path/to/Kindle.Devices.ReadingSession.csv \
  --metadata path/to/Kindle.KindleDocs.DocumentMetadata.csv \
  --merge
```

### オプション

| オプション | 必須 | 説明 |
|-----------|------|------|
| `--sessions <path>` | Yes | ReadingSession.csv のパス |
| `--metadata <path>` | No | DocumentMetadata.csv のパス（タイトル取得用） |
| `--merge` | No | 既存の books.json とマージする |

## 4. 手動で補完する

スクリプト実行後、`data/books.json` を開いて以下を補完してください。

### 著者名

CSVに著者名が含まれない場合、`author` が空になります。

```json
"author": "" → "author": "著者名"
```

### ISBN

ISBNを追加すると、表紙画像が国立国会図書館から自動取得されます。
ISBNはAmazonの商品ページの「登録情報」欄、または本の奥付で確認できます。

```json
"isbn": "9784000000000"
```

### currentPage の精度について

`currentPage` はページめくり数（`number_of_page_flips`）の累計から算出しています。
ページめくりには戻る操作も含まれるため、実際のページ番号とは異なる場合があります。
気になる場合はKindleアプリで実際のページ数を確認して修正してください。
