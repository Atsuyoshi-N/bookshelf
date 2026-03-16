#!/usr/bin/env node

/**
 * books.json 内の coverUrl が未設定の本について、
 * Google Books APIから表紙画像URLを取得するスクリプト
 *
 * 使い方:
 *   node scripts/fetch-covers.mjs
 *
 * オプション:
 *   --dry-run  変更を保存せずに結果だけ表示
 *   --all      coverURLが既にある本も含めて全て対象にする
 *   --delay    リクエスト間の待機時間(ms)。デフォルト: 500
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_JSON_PATH = path.join(__dirname, "..", "data", "books.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { dryRun: false, all: false, delay: 500, asinsFile: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") parsed.dryRun = true;
    else if (args[i] === "--all") parsed.all = true;
    else if (args[i] === "--delay" && args[i + 1]) {
      parsed.delay = parseInt(args[++i], 10);
    } else if (args[i] === "--asins-file" && args[i + 1]) {
      parsed.asinsFile = args[++i];
    }
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clean title for search
 */
function cleanTitleForSearch(title) {
  return title
    .replace(/\s*[\(（](?![０-９\d]+[\)）])[^）\)]*[\)）]\s*/g, "") // Remove (アフタヌーンコミックス) but keep （２）
    .replace(/\s*[\[【].*?[\]】]\s*/g, "") // Remove [雑誌] etc
    .replace(/　/g, " ") // Full-width space to half-width
    .trim();
}

/**
 * Search Google Books API for cover image URL
 */
async function searchCover(title) {
  const query = cleanTitleForSearch(title);
  const url = `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(query)}&langRestrict=ja&maxResults=5`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429) return { rateLimited: true };
      return null;
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) return null;

    const cleanedQuery = cleanTitleForSearch(title).toLowerCase();

    // Extract volume number from title
    const volMatch = title.match(/[（(]\s*([０-９\d]+)\s*[）)]/);
    const queryVolume = volMatch
      ? volMatch[1].replace(/[０-９]/g, (c) =>
          String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30)
        )
      : null;

    for (const item of data.items) {
      const vi = item.volumeInfo ?? {};
      const resultTitle = (vi.title ?? "").toLowerCase();

      // Title matching
      if (
        !resultTitle.includes(cleanedQuery) &&
        !cleanedQuery.includes(resultTitle)
      ) {
        continue;
      }

      // Volume number matching for series
      if (queryVolume) {
        const fullResultTitle = `${vi.title ?? ""} ${vi.subtitle ?? ""}`;
        const resultVolMatch = fullResultTitle.match(/(\d+)/);
        if (resultVolMatch && resultVolMatch[1] !== queryVolume) {
          continue;
        }
      }

      const imageLinks = vi.imageLinks;
      if (imageLinks) {
        // Prefer thumbnail, upgrade to larger size
        let coverUrl = imageLinks.thumbnail || imageLinks.smallThumbnail;
        if (coverUrl) {
          // Upgrade to higher resolution: zoom=1 → zoom=0 for full size
          coverUrl = coverUrl
            .replace("zoom=5", "zoom=0")
            .replace("zoom=1", "zoom=0")
            .replace("&edge=curl", "")
            .replace("http://", "https://");

          // Verify the image is not the "image not available" placeholder
          const valid = await verifyNotPlaceholder(coverUrl);
          if (valid) return coverUrl;
        }
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Check that a cover URL does not return Google Books' "image not available" placeholder.
 * The placeholder is a 575x750 image, consistently ~9103 bytes.
 */
async function verifyNotPlaceholder(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) return false;
    const contentLength = response.headers.get("content-length");
    // The placeholder is exactly 9103 bytes; allow a small range to be safe
    if (contentLength && parseInt(contentLength, 10) < 10000) {
      return false;
    }
    return true;
  } catch {
    return true; // On error, assume valid and let the browser handle it
  }
}

async function main() {
  const args = parseArgs();

  const data = JSON.parse(fs.readFileSync(BOOKS_JSON_PATH, "utf-8"));
  const books = data.books;

  // Load ASIN filter if specified
  const asinFilter = args.asinsFile
    ? new Set(fs.readFileSync(args.asinsFile, "utf-8").trim().split("\n").map((s) => s.trim()).filter(Boolean))
    : null;

  const targets = books.filter((b) => {
    if (!b.title || b.title.startsWith("不明") || b.title === "Amazon.co.jp")
      return false;
    if (asinFilter && !asinFilter.has(b.asin)) return false;
    if (args.all) return true;
    return !b.coverUrl;
  });

  console.log(`対象: ${targets.length}冊`);
  console.log(`待機時間: ${args.delay}ms`);
  if (args.dryRun) console.log("(ドライラン: 変更は保存されません)");
  console.log();

  let updated = 0;
  let failed = 0;
  let rateLimited = 0;

  for (let i = 0; i < targets.length; i++) {
    const book = targets[i];
    process.stdout.write(
      `[${i + 1}/${targets.length}] ${book.title.substring(0, 50)} ... `
    );

    const result = await searchCover(book.title);

    if (result && typeof result === "object" && result.rateLimited) {
      console.log("レート制限（待機中）");
      rateLimited++;
      // Wait and retry
      await sleep(10000);
      i--;
      if (rateLimited >= 10) {
        console.log("\nレート制限が多すぎるため中断します。");
        break;
      }
      continue;
    }

    if (result) {
      book.coverUrl = result;
      console.log("取得済み");
      updated++;
    } else {
      console.log("見つからず");
      failed++;
    }

    if (i < targets.length - 1) {
      await sleep(args.delay);
    }
  }

  console.log();
  console.log(
    `結果: 更新 ${updated}冊, 未検出 ${failed}冊, レート制限 ${rateLimited}回`
  );

  if (!args.dryRun && updated > 0) {
    fs.writeFileSync(BOOKS_JSON_PATH, JSON.stringify(data, null, 2) + "\n");
    console.log(`${BOOKS_JSON_PATH} を更新しました`);
  }
}

main();
