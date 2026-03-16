# Kindle Bookshelf

Kindleの読書記録を本棚のように表示する静的サイト。

## セットアップ

```bash
npm install
npm run dev
```

http://localhost:3000 で確認できます。

## 読書データの管理

### 方法1: Amazonデータエクスポートからインポート

詳しくは [scripts/README.md](scripts/README.md) を参照してください。

### 方法2: 手動で books.json を編集

`data/books.json` を直接編集して本や読書セッションを追加できます。

```json
{
  "books": [
    {
      "id": "my-book",
      "title": "本のタイトル",
      "author": "著者名",
      "isbn": "9784000000000",
      "totalPages": 300,
      "progressType": "page",
      "sessions": [
        { "date": "2026-03-01", "currentPage": 50 },
        { "date": "2026-03-05", "currentPage": 130 }
      ]
    }
  ]
}
```

#### フィールド説明

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `id` | Yes | URL用のスラッグ（英数字・ハイフン） |
| `title` | Yes | 本のタイトル |
| `author` | Yes | 著者名 |
| `isbn` | No | ISBN-13。設定すると表紙画像を自動取得 |
| `coverUrl` | No | 表紙画像のURL（ISBNより優先） |
| `totalPages` | No | 総ページ数（進捗バーの表示に使用） |
| `progressType` | Yes | `"page"` または `"percent"` |
| `sessions` | Yes | 読書セッションの配列 |

#### セッションのフィールド

| フィールド | 説明 |
|-----------|------|
| `date` | 読んだ日（YYYY-MM-DD） |
| `currentPage` | その時点のページ数（`progressType: "page"` の場合） |
| `currentPercent` | その時点の進捗%（`progressType: "percent"` の場合） |
| `readingTimeMinutes` | 読書時間（分）。Amazonデータからの自動設定 |
| `round` | 周回数（再読する場合。省略時は1） |

読み終わった時点の **現在のページ数（または%）だけ** 記録すれば、前回との差分はシステムが自動計算します。

## ビルド・デプロイ

```bash
# ビルド
npm run build

# ビルド結果のプレビュー
npx serve out
```

### GitHub Pages

`main` ブランチにpushすると `.github/workflows/deploy.yml` が自動でビルド・デプロイします。

### Vercel

リポジトリをVercelに接続するだけで自動デプロイされます。
