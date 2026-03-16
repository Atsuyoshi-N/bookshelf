#!/usr/bin/env node

/**
 * books.json 内のISBN・総ページ数が未設定の本について、
 * 国立国会図書館（NDL）検索APIとGoogle Books APIからメタデータを取得するスクリプト
 *
 * 使い方:
 *   node scripts/fetch-metadata.mjs
 *
 * オプション:
 *   --dry-run  変更を保存せずに結果だけ表示
 *   --all      ISBN/ページ数が既にある本も含めて全て対象にする
 *   --delay    リクエスト間の待機時間(ms)。デフォルト: 1000
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_JSON_PATH = path.join(__dirname, "..", "data", "books.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { dryRun: false, all: false, delay: 1000, asinsFile: null };

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
 * Convert Roman numeral string to Arabic number.
 * Handles both full-width (Ｉ,Ｖ,Ｘ) and half-width (I,V,X) characters.
 */
function romanToArabic(roman) {
  // Normalize full-width Roman chars to half-width
  const normalized = roman.replace(/[Ｉ-Ｚ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xff21 + 0x41)
  );
  const values = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let result = 0;
  for (let i = 0; i < normalized.length; i++) {
    const curr = values[normalized[i]];
    const next = values[normalized[i + 1]];
    if (!curr) return null;
    if (next && curr < next) {
      result += next - curr;
      i++;
    } else {
      result += curr;
    }
  }
  return result > 0 ? String(result) : null;
}

/**
 * Clean title for search: remove series info, volume numbers, publisher tags
 */
function cleanTitleForSearch(title) {
  return title
    .replace(/^原作版\s*/, "") // Remove "原作版 " prefix
    .replace(/\s*[\(（](?![０-９\d]+[\)）])[^）\)]*[\)）]\s*/g, " ") // Remove (アフタヌーンコミックス) but keep （２）
    .replace(/\s*【極！[^】]*】\s*/g, "") // Remove 【極！単行本シリーズ】【極！合本シリーズ】
    .replace(/\s*【電子[^】]*】\s*/g, "") // Remove 【電子特別版】【電子書籍限定】
    .replace(/\s*\[雑誌\]\s*/g, "") // Remove [雑誌]
    .replace(/[【】\[\]]/g, "") // Remove remaining brackets but keep content (e.g., 【推しの子】→推しの子)
    .replace(/\s*カラー版\s*/g, " ") // Remove カラー版
    .replace(/\d+巻\s*$/, "") // Remove trailing 54巻
    .replace(/\s*[：:].+$/, "") // Remove subtitle after ： or : (e.g., ": 広告営業の奔走")
    .replace(/\s+[ＩIＶVＸXＬLＣCＤDＭMivxlcdm][ＩIＶVＸXＬLＣCＤDＭMivxlcdm]*\s*$/, "") // Remove trailing Roman numerals (e.g., " III", " ＩX")
    .replace(/[（）()]/g, " ") // Full/half-width parens to space (remaining volume parens etc.)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30)) // Full-width digits to half-width
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff21 + (c <= 'Ｚ' ? 0x41 : 0x61))) // Full-width alpha to half-width
    .replace(/　/g, " ") // Full-width space to half-width
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim();
}

/**
 * Extract volume number from title in various formats
 * Returns volume as string or null
 */
function extractVolume(title) {
  // Pattern 1: Full-width parens （２） or (2)
  let m = title.match(/[（(]\s*([０-９\d]+)\s*[）)]/);
  if (m) {
    return m[1].replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30));
  }
  // Pattern 2: 54巻
  m = title.match(/(\d+)巻/);
  if (m) return m[1];
  // Pattern 3: Roman numerals (e.g., "III", "ＩX", "Ｖ")
  m = title.match(/\s([ＩIＶVＸXＬLＣCＤDＭMivxlcdm][ＩIＶVＸXＬLＣCＤDＭMivxlcdm]*)\s*(?:\(|（|$)/);
  if (m) {
    const arabic = romanToArabic(m[1]);
    if (arabic) return arabic;
  }
  // Pattern 4: Trailing number after cleaning (e.g., "推しの子 16", "ワールドトリガー 29")
  const cleaned = cleanTitleForSearch(title);
  m = cleaned.match(/\s(\d+)\s*$/);
  if (m) return m[1];
  return null;
}

/**
 * Normalize title for comparison: strip punctuation differences between
 * Kindle titles and NDL titles (e.g., ～ vs -, ： vs :, etc.)
 */
function normalizeTitleForComparison(title) {
  return title
    .replace(/[：:・～〜\-−–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Search NDL (National Diet Library) API
 * Returns { isbn, totalPages } or null
 */
async function searchNDL(title, author) {
  const queryVolume = extractVolume(title);
  // Remove volume number from title for NDL search (NDL's title param is strict)
  const query = cleanTitleForSearch(title).replace(/\s*\d+\s*$/, "").trim();

  // Build search strategies:
  // 1. Strict title search (with author if available)
  // 2. For series, try with larger cnt to find specific volumes
  // 3. For non-series, fallback to broad `any` keyword search
  const searches = [{ title: query }];
  if (!queryVolume) {
    // For non-series books, also try broad keyword search as fallback
    // Use shorter query for `any` to improve recall
    // Take first ~40 chars or up to first subtitle separator
    let shortQuery = query.replace(/[：:―—].*$/, "").trim();
    if (shortQuery.length > 40) {
      shortQuery = shortQuery.substring(0, 40).replace(/\s+\S*$/, "").trim();
    }
    searches.push({ any: shortQuery || query });
  }

  for (const searchParams of searches) {
    const cnt = queryVolume ? "100" : "30";
    const params = new URLSearchParams({ ...searchParams, cnt });
    if (author) {
      params.set("creator", author);
    }
    const url = `https://ndlsearch.ndl.go.jp/api/opensearch?${params}`;

    try {
      const response = await fetch(url);
      if (!response.ok) continue;

      const xml = await response.text();
      const items = xml.split("<item>").slice(1);

      let bestMatch = null;

      for (const item of items) {
        // Skip audio/video items (use specific patterns to avoid matching XML CDATA/CDTF)
        if (item.includes("デイジー") || item.includes("録音") || /[>、\s]CD[<、\s]/.test(item)) {
          continue;
        }

        // Extract title
        const itemTitleMatch = item.match(/<title>([^<]+)/);
        const itemTitle = itemTitleMatch?.[1] ?? "";

        // Volume number matching for series
        if (queryVolume) {
          const ndlVolMatch = item.match(/<dcndl:volume>([^<]+)/);
          const itemVolMatch = ndlVolMatch
            ? ndlVolMatch[1].trim().match(/(\d+)/)
            : itemTitle.match(/(\d+)/);
          if (!itemVolMatch) {
            continue;
          }
          if (itemVolMatch[1] !== queryVolume) {
            continue;
          }
        }

        // Extract ISBN
        let isbn = null;
        const isbn13Match = item.match(
          /type="dcndl:ISBN"[^>]*>(\d{3}[-\s]?\d[-\s]?\d{2}[-\s]?\d{6}[-\s]?\d)/
        );
        if (isbn13Match) {
          isbn = isbn13Match[1].replace(/[-\s]/g, "");
        }
        if (!isbn) {
          const isbnMatch = item.match(
            /type="dcndl:ISBN"[^>]*>([\d-]+)/
          );
          if (isbnMatch) {
            isbn = isbnMatch[1].replace(/[-\s]/g, "");
          }
        }

        // Extract page count from extent (e.g., "323p", "462p ; 20cm")
        let totalPages = null;
        const extentMatch = item.match(/<dc:extent[^>]*>(\d+)p/);
        if (extentMatch) {
          totalPages = parseInt(extentMatch[1], 10);
        }

        if (isbn || totalPages) {
          const baseNorm = normalizeTitleForComparison(query);
          const itemNorm = normalizeTitleForComparison(cleanTitleForSearch(itemTitle));
          // Also compare without spaces (handles "ナナマルサンバツ" vs "ナナマル サンバツ")
          const baseNoSpace = baseNorm.replace(/\s/g, "");
          const itemNoSpace = itemNorm.replace(/\s/g, "");

          // Exact match (normalized titles are equal) — best result
          if (itemNorm === baseNorm || itemNoSpace === baseNoSpace) {
            return { isbn, totalPages };
          }

          // For series with volume numbers, only accept exact title matches
          if (queryVolume) {
            continue;
          }

          // Partial match — save as fallback (only for non-series books)
          if (
            itemNorm.includes(baseNorm) ||
            baseNorm.includes(itemNorm) ||
            itemNoSpace.includes(baseNoSpace) ||
            baseNoSpace.includes(itemNoSpace)
          ) {
            if (!bestMatch) {
              bestMatch = { isbn, totalPages };
            }
          }
        }
      }

      if (bestMatch) return bestMatch;
    } catch (error) {
      console.error(`  NDLエラー: ${error.message}`);
    }
  }

  return null;
}

/**
 * Search Google Books API
 * Returns { isbn, totalPages } or null
 */
async function searchGoogleBooks(title) {
  const query = cleanTitleForSearch(title);
  const url = `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(query)}&langRestrict=ja&maxResults=3`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.items || data.items.length === 0) return null;

    const cleanedQuery = cleanTitleForSearch(title).toLowerCase();

    // Extract volume number from original title (e.g., "メダリスト（２）" → "2")
    const volMatch = title.match(/[（(]\s*([０-９\d]+)\s*[）)]/);
    const queryVolume = volMatch
      ? volMatch[1].replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
      : null;

    for (const item of data.items) {
      const vi = item.volumeInfo ?? {};
      const resultTitle = (vi.title ?? "").toLowerCase();

      // Skip results that don't reasonably match the title
      // (prevents series mismatch, e.g., vol.10 matching vol.2)
      if (
        !resultTitle.includes(cleanedQuery) &&
        !cleanedQuery.includes(resultTitle)
      ) {
        continue;
      }

      // If the query has a volume number, check the result also matches that volume
      if (queryVolume) {
        const fullResultTitle = `${vi.title ?? ""} ${vi.subtitle ?? ""}`;
        const resultVolMatch = fullResultTitle.match(/(\d+)/);
        if (resultVolMatch && resultVolMatch[1] !== queryVolume) {
          continue;
        }
      }

      let isbn = null;
      let totalPages = vi.pageCount > 0 ? vi.pageCount : null;

      const identifiers = vi.industryIdentifiers ?? [];
      for (const id of identifiers) {
        if (id.type === "ISBN_13") {
          isbn = id.identifier;
          break;
        }
        if (id.type === "ISBN_10" && !isbn) {
          isbn = id.identifier;
        }
      }

      if (isbn || totalPages) {
        return { isbn, totalPages };
      }
    }

    return null;
  } catch (error) {
    return null;
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

  // Target books with known titles but missing ISBN or totalPages
  const targets = books.filter((b) => {
    if (!b.title || b.title.startsWith("不明") || b.title === "Amazon.co.jp") return false;
    if (asinFilter && !asinFilter.has(b.asin)) return false;
    if (args.all) return true;
    return !b.isbn || !b.totalPages;
  });

  console.log(`対象: ${targets.length}冊`);
  console.log(`待機時間: ${args.delay}ms`);
  console.log("ソース: NDL検索API（タイトル+著者） → Google Books API");
  if (args.dryRun) console.log("(ドライラン: 変更は保存されません)");
  console.log();

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const book = targets[i];
    process.stdout.write(
      `[${i + 1}/${targets.length}] ${book.title.substring(0, 40)} ... `
    );

    // Try NDL first (with author for better matching)
    let result = await searchNDL(book.title, book.author);
    let source = "NDL";

    // Fallback to Google Books
    if (!result || (!result.isbn && !result.totalPages)) {
      await sleep(500);
      result = await searchGoogleBooks(book.title);
      source = "Google";
    }

    if (result) {
      let changes = [];

      if (result.isbn && !book.isbn) {
        // Normalize to 13-digit ISBN
        let isbn = result.isbn;
        if (isbn.length === 10) {
          isbn = isbn10to13(isbn);
        }
        book.isbn = isbn;
        changes.push(`ISBN: ${isbn}`);
      }

      if (result.totalPages && !book.totalPages) {
        book.totalPages = result.totalPages;
        changes.push(`${result.totalPages}ページ`);
      }

      if (changes.length > 0) {
        console.log(`${changes.join(", ")} (${source})`);
        updated++;
      } else {
        console.log("新しい情報なし");
      }
    } else {
      console.log("見つからず");
      failed++;
    }

    if (i < targets.length - 1) {
      await sleep(args.delay);
    }
  }

  console.log();
  console.log(`結果: 更新 ${updated}冊, 未検出 ${failed}冊`);

  if (!args.dryRun && updated > 0) {
    fs.writeFileSync(BOOKS_JSON_PATH, JSON.stringify(data, null, 2) + "\n");
    console.log(`${BOOKS_JSON_PATH} を更新しました`);
  }
}

/**
 * Convert ISBN-10 to ISBN-13
 */
function isbn10to13(isbn10) {
  const base = "978" + isbn10.substring(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

main();
