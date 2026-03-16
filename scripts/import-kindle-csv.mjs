#!/usr/bin/env node

/**
 * Amazon Kindleデータエクスポートから books.json を生成するスクリプト
 *
 * 使い方:
 *   node scripts/import-kindle-csv.mjs \
 *     --sessions path/to/Kindle.Devices.ReadingSession.csv \
 *     --metadata path/to/Kindle.KindleDocs.DocumentMetadata.csv
 *
 * オプション:
 *   --merge  既存の books.json とマージする（デフォルト: 上書き）
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_JSON_PATH = path.join(__dirname, "..", "data", "books.json");

// --- CSV Parser ---

function parseCSV(content) {
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

// --- Args ---

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { sessions: null, metadata: null, merge: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sessions" && args[i + 1]) {
      parsed.sessions = args[++i];
    } else if (args[i] === "--metadata" && args[i + 1]) {
      parsed.metadata = args[++i];
    } else if (args[i] === "--merge") {
      parsed.merge = true;
    }
  }

  if (!parsed.sessions) {
    console.error("エラー: --sessions オプションが必要です");
    console.error(
      "使い方: node scripts/import-kindle-csv.mjs --sessions <ReadingSession.csv> --metadata <DocumentMetadata.csv>"
    );
    process.exit(1);
  }

  return parsed;
}

// --- ASIN to slug ---

function asinToSlug(asin) {
  return asin.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

// --- Find column by partial match ---

function findColumn(row, candidates) {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const found = keys.find(
      (k) => k.toLowerCase().includes(candidate.toLowerCase())
    );
    if (found) return found;
  }
  return null;
}

// --- Main ---

function main() {
  const args = parseArgs();

  // Parse ReadingSession CSV
  const sessionsContent = fs.readFileSync(args.sessions, "utf-8");
  const sessionsRows = parseCSV(sessionsContent);

  if (sessionsRows.length === 0) {
    console.error("エラー: ReadingSession.csv にデータがありません");
    process.exit(1);
  }

  // Detect column names from first row
  const sampleSession = sessionsRows[0];
  const colASIN_s =
    findColumn(sampleSession, ["ASIN", "asin"]) || "ASIN";
  const colTimestamp =
    findColumn(sampleSession, [
      "start_timestamp",
      "timestamp",
      "start_time",
    ]) || "start_timestamp";
  const colReadingMillis =
    findColumn(sampleSession, [
      "total_reading_millis",
      "reading_millis",
      "reading_time",
    ]) || "total_reading_millis";
  const colPageFlips =
    findColumn(sampleSession, [
      "number_of_page_flips",
      "page_flips",
      "page_turns",
    ]) || "number_of_page_flips";

  console.log("ReadingSession カラム検出:");
  console.log(`  ASIN: ${colASIN_s}`);
  console.log(`  タイムスタンプ: ${colTimestamp}`);
  console.log(`  読書時間: ${colReadingMillis}`);
  console.log(`  ページめくり: ${colPageFlips}`);
  console.log(`  セッション数: ${sessionsRows.length}`);
  console.log();

  // Parse Metadata CSV (optional)
  const metadataMap = new Map(); // ASIN -> { title, author? }

  if (args.metadata) {
    const metaContent = fs.readFileSync(args.metadata, "utf-8");
    const metaRows = parseCSV(metaContent);

    if (metaRows.length > 0) {
      const sampleMeta = metaRows[0];
      const colASIN_m =
        findColumn(sampleMeta, ["ASIN", "asin"]) || "ASIN";
      const colTitle =
        findColumn(sampleMeta, ["title", "Title"]) || "Title";
      const colAuthor = findColumn(sampleMeta, ["author", "Author"]);

      console.log("DocumentMetadata カラム検出:");
      console.log(`  ASIN: ${colASIN_m}`);
      console.log(`  タイトル: ${colTitle}`);
      console.log(`  著者: ${colAuthor ?? "(なし)"}`);
      console.log(`  書籍数: ${metaRows.length}`);
      console.log();

      for (const row of metaRows) {
        const asin = row[colASIN_m];
        if (!asin) continue;
        metadataMap.set(asin, {
          title: row[colTitle] || `不明 (${asin})`,
          author: colAuthor ? row[colAuthor] || "" : "",
        });
      }
    }
  }

  // Group sessions by ASIN, then by date
  const bookSessions = new Map();

  for (const row of sessionsRows) {
    const asin = row[colASIN_s];
    if (!asin) continue;

    const timestamp = row[colTimestamp];
    const date = timestamp
      ? new Date(timestamp).toISOString().split("T")[0]
      : null;
    if (!date || date === "Invalid") continue;

    const readingMillis = parseInt(row[colReadingMillis] || "0", 10);
    const pageFlips = parseInt(row[colPageFlips] || "0", 10);

    if (!bookSessions.has(asin)) {
      bookSessions.set(asin, new Map());
    }

    const dateSessions = bookSessions.get(asin);
    if (!dateSessions.has(date)) {
      dateSessions.set(date, { readingMillis: 0, pageFlips: 0 });
    }

    const existing = dateSessions.get(date);
    existing.readingMillis += readingMillis;
    existing.pageFlips += pageFlips;
  }

  // Build books array
  const books = [];

  for (const [asin, dateSessions] of bookSessions) {
    const meta = metadataMap.get(asin);
    const title = meta?.title || `不明 (${asin})`;
    const author = meta?.author || "";

    // Sort dates chronologically
    const sortedDates = Array.from(dateSessions.keys()).sort();

    // Accumulate page flips to create currentPage
    let cumulativePages = 0;
    const sessions = [];

    for (const date of sortedDates) {
      const data = dateSessions.get(date);
      cumulativePages += data.pageFlips;
      const readingTimeMinutes = Math.round(data.readingMillis / 60000);

      sessions.push({
        date,
        currentPage: cumulativePages,
        ...(readingTimeMinutes > 0 ? { readingTimeMinutes } : {}),
      });
    }

    // Skip books with no meaningful sessions
    if (sessions.length === 0) continue;

    books.push({
      id: asinToSlug(asin),
      title,
      author,
      asin,
      progressType: "page",
      sessions,
    });
  }

  // Sort by last read date descending
  books.sort((a, b) => {
    const dateA = a.sessions[a.sessions.length - 1]?.date ?? "";
    const dateB = b.sessions[b.sessions.length - 1]?.date ?? "";
    return dateB.localeCompare(dateA);
  });

  // Merge with existing books.json if --merge
  let output = { books };

  if (args.merge && fs.existsSync(BOOKS_JSON_PATH)) {
    const existing = JSON.parse(fs.readFileSync(BOOKS_JSON_PATH, "utf-8"));
    const existingIds = new Set(existing.books.map((b) => b.id));
    const existingAsins = new Set(
      existing.books.filter((b) => b.asin).map((b) => b.asin)
    );

    const newBooks = books.filter(
      (b) => !existingIds.has(b.id) && !existingAsins.has(b.asin)
    );

    output = {
      books: [...existing.books, ...newBooks],
    };

    console.log(
      `マージ: 既存 ${existing.books.length}冊 + 新規 ${newBooks.length}冊`
    );
  }

  // Write books.json
  fs.writeFileSync(BOOKS_JSON_PATH, JSON.stringify(output, null, 2) + "\n");

  console.log(`完了: ${output.books.length}冊を ${BOOKS_JSON_PATH} に書き出しました`);
  console.log();
  console.log("注意:");
  console.log(
    "  - 著者名・ISBNが不足している場合は books.json を手動で補完してください"
  );
  console.log(
    "  - ISBNを追加すると表紙画像が自動取得されます"
  );
  console.log(
    '  - "currentPage" はページめくり数の累計値で、実際のページ番号とは異なる場合があります'
  );
}

main();
