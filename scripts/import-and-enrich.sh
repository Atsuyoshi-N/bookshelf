#!/bin/bash

# Google Sheetsから取得したタイトル・著者データを反映し、
# ISBN・ページ数・表紙画像を一括取得するスクリプト
#
# 使い方:
#   pbpaste | ./scripts/import-and-enrich.sh        # クリップボードから（対象のみ更新）
#   ./scripts/import-and-enrich.sh data/result.tsv   # TSVファイルから
#   pbpaste | ./scripts/import-and-enrich.sh --dry-run  # 確認のみ
#   pbpaste | ./scripts/import-and-enrich.sh --all   # 全冊対象でISBN・表紙を取得

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DRY_RUN=""
INPUT_FILE=""
ALL=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="--dry-run" ;;
    --all) ALL="--all" ;;
    *) INPUT_FILE="$arg" ;;
  esac
done

# Determine input source
if [ -n "$INPUT_FILE" ]; then
  SOURCE="$INPUT_FILE"
else
  SOURCE="-"
fi

# Temp file for updated ASINs
ASINS_FILE=$(mktemp)
trap "rm -f $ASINS_FILE" EXIT

echo "=== 1/3 タイトル・著者を反映 ==="
if [ "$SOURCE" = "-" ]; then
  cat | node "$SCRIPT_DIR/import-titles-tsv.mjs" - $DRY_RUN --output-asins "$ASINS_FILE"
else
  node "$SCRIPT_DIR/import-titles-tsv.mjs" "$SOURCE" $DRY_RUN --output-asins "$ASINS_FILE"
fi

# Determine scope for metadata/covers
SCOPE_ARGS=""
if [ -z "$ALL" ] && [ -s "$ASINS_FILE" ]; then
  SCOPE_ARGS="--asins-file $ASINS_FILE"
elif [ -z "$ALL" ] && [ ! -s "$ASINS_FILE" ]; then
  echo ""
  echo "更新対象がないため、ISBN・表紙の取得をスキップします。"
  exit 0
fi

echo ""
echo "=== 2/3 ISBN・ページ数を取得 ==="
node "$SCRIPT_DIR/fetch-metadata.mjs" $DRY_RUN $SCOPE_ARGS

echo ""
echo "=== 3/3 表紙画像URLを取得 ==="
node "$SCRIPT_DIR/fetch-covers.mjs" $DRY_RUN $SCOPE_ARGS
