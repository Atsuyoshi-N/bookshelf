#!/usr/bin/env node

/**
 * Google Sheets等から取得したタイトル・著者名のTSVを books.json に反映するスクリプト
 *
 * 入力TSV形式（タブ区切り、ヘッダーなし）:
 *   ASIN\tタイトル\t著者
 *   または
 *   ASIN\tURL\tタイトル\t著者
 *
 * 使い方:
 *   node scripts/import-titles-tsv.mjs data/result.tsv
 *   node scripts/import-titles-tsv.mjs data/result.tsv --dry-run
 *   cat data/result.tsv | node scripts/import-titles-tsv.mjs -
 *
 * オプション:
 *   --dry-run  変更を保存せずに結果だけ表示
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_JSON_PATH = path.join(__dirname, "..", "data", "books.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { file: null, dryRun: false, outputAsins: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") parsed.dryRun = true;
    else if (args[i] === "--output-asins" && args[i + 1]) {
      parsed.outputAsins = args[++i];
    }
    else if (!parsed.file) parsed.file = args[i];
  }

  return parsed;
}

function readInput(filePath) {
  if (filePath === "-") {
    return fs.readFileSync("/dev/stdin", "utf-8");
  }
  return fs.readFileSync(filePath, "utf-8");
}

function parseTSV(text) {
  const results = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cols = trimmed.split("\t");

    // Skip header row
    if (cols[0] === "ASIN" || cols[0] === "asin") continue;

    let asin, title, author;

    // Filter out URL columns and error values, then extract ASIN/title/author
    const isUrl = (s) => s && s.startsWith("http");
    const filtered = cols.filter((c) => !isUrl(c.trim()));

    if (filtered.length >= 3) {
      [asin, title, author] = filtered;
    } else if (filtered.length === 2) {
      [asin, title] = filtered;
      author = "";
    } else {
      continue;
    }

    asin = asin?.trim();
    title = title?.trim();
    author = author?.trim();

    // Skip empty/error results
    const errorValues = ["#N/A", "#VALUE!", "#ERROR!", "#REF!", ""];
    if (!asin || !title || errorValues.includes(title)) {
      continue;
    }
    if (author && errorValues.includes(author)) {
      author = "";
    }

    results.push({ asin, title, author: author || null });
  }

  return results;
}

function main() {
  const args = parseArgs();

  if (!args.file) {
    console.error("使い方: node scripts/import-titles-tsv.mjs <TSVファイル> [--dry-run]");
    console.error("  例: node scripts/import-titles-tsv.mjs data/result.tsv");
    console.error("  例: pbpaste | node scripts/import-titles-tsv.mjs -");
    process.exit(1);
  }

  const input = readInput(args.file);
  const entries = parseTSV(input);

  if (entries.length === 0) {
    console.log("有効なエントリが見つかりませんでした。");
    process.exit(0);
  }

  console.log(`入力: ${entries.length}件`);
  if (args.dryRun) console.log("(ドライラン: 変更は保存されません)");
  console.log();

  const data = JSON.parse(fs.readFileSync(BOOKS_JSON_PATH, "utf-8"));
  const bookMap = new Map(data.books.map((b) => [b.asin, b]));

  let updated = 0;
  let skipped = 0;
  let notFound = 0;
  const updatedAsins = [];

  for (const entry of entries) {
    const book = bookMap.get(entry.asin);

    if (!book) {
      console.log(`  [不明] ${entry.asin} — books.json に存在しません`);
      notFound++;
      continue;
    }

    const needsTitle = !book.title || book.title.startsWith("不明") || book.title === "Amazon.co.jp";
    const needsAuthor = !book.author && entry.author;

    if (!needsTitle && !needsAuthor) {
      skipped++;
      continue;
    }

    const changes = [];
    if (needsTitle) {
      book.title = entry.title;
      changes.push(`タイトル: ${entry.title}`);
    }
    if (needsAuthor) {
      book.author = entry.author;
      changes.push(`著者: ${entry.author}`);
    }

    console.log(`  [更新] ${entry.asin}`);
    for (const c of changes) console.log(`         ${c}`);
    updatedAsins.push(entry.asin);
    updated++;
  }

  if (args.outputAsins && updatedAsins.length > 0) {
    fs.writeFileSync(args.outputAsins, updatedAsins.join("\n") + "\n");
  }

  console.log();
  console.log(`結果: 更新 ${updated}件, スキップ ${skipped}件, 不明 ${notFound}件`);

  if (!args.dryRun && updated > 0) {
    fs.writeFileSync(BOOKS_JSON_PATH, JSON.stringify(data, null, 2) + "\n");
    console.log(`${BOOKS_JSON_PATH} を更新しました`);
    console.log();
    console.log("次のステップ:");
    console.log("  node scripts/fetch-metadata.mjs  # ISBN・ページ数を取得");
    console.log("  node scripts/fetch-covers.mjs    # 表紙画像URLを取得");
  }
}

main();
