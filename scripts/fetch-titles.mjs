#!/usr/bin/env node

/**
 * books.json 内のタイトル不明の本について、ASINからAmazon.co.jpの
 * 商品ページを参照してタイトル・著者名を取得するスクリプト
 *
 * 使い方:
 *   node scripts/fetch-titles.mjs
 *
 * オプション:
 *   --dry-run  変更を保存せずに結果だけ表示
 *   --all      タイトル不明の本だけでなく全ての本を対象にする
 *   --covers   表紙画像URLが未設定の本を対象にする
 *   --delay    リクエスト間の待機時間(ms)。デフォルト: 3000
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_JSON_PATH = path.join(__dirname, "..", "data", "books.json");

// Amazon bot検出時に返される無効なタイトル
const INVALID_TITLES = [
  "amazon.co.jp",
  "amazon",
  "ページが見つかりません",
  "page not found",
  "something went wrong",
  "robot check",
  "",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { dryRun: false, all: false, covers: false, delay: 3000 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") parsed.dryRun = true;
    else if (args[i] === "--all") parsed.all = true;
    else if (args[i] === "--covers") parsed.covers = true;
    else if (args[i] === "--delay" && args[i + 1]) {
      parsed.delay = parseInt(args[++i], 10);
    }
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidTitle(title) {
  if (!title) return false;
  const lower = title.toLowerCase().trim();
  return !INVALID_TITLES.some((invalid) => lower === invalid);
}

async function fetchTitleFromAmazon(asin) {
  const url = `https://www.amazon.co.jp/dp/${asin}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return { blocked: response.status === 503 || response.status === 429 };
    }

    const html = await response.text();

    // Detect bot block / captcha page
    if (
      html.includes("captcha") ||
      html.includes("robot") ||
      html.includes("automated access")
    ) {
      return { blocked: true };
    }

    let title = null;
    let author = null;

    // Try productTitle span
    const titleMatch = html.match(
      /id="productTitle"[^>]*>\s*([^<]+)/
    );
    if (titleMatch) {
      title = titleMatch[1].trim();
    }

    // Try ebooksProductTitle
    if (!title) {
      const ebookTitleMatch = html.match(
        /id="ebooksProductTitle"[^>]*>\s*([^<]+)/
      );
      if (ebookTitleMatch) {
        title = ebookTitleMatch[1].trim();
      }
    }

    // Try og:title meta tag
    if (!title) {
      const ogMatch = html.match(
        /property="og:title"\s+content="([^"]+)"/
      );
      if (ogMatch) {
        title = ogMatch[1].trim();
      }
    }

    // Fallback to <title> tag, but extract product name only
    if (!title) {
      const pageTitleMatch = html.match(/<title[^>]*>([^<]+)/);
      if (pageTitleMatch) {
        let raw = pageTitleMatch[1].trim();
        // "商品名 | Amazon.co.jp" → "商品名"
        raw = raw.replace(/\s*[\|｜].*Amazon.*$/i, "").trim();
        // "Amazon.co.jp: 商品名" → "商品名"
        raw = raw.replace(/^Amazon\.co\.jp[:：]\s*/i, "").trim();
        if (raw && raw.toLowerCase() !== "amazon.co.jp") {
          title = raw;
        }
      }
    }

    // Try to find total pages
    let totalPages = null;

    // Look for page count in product detail sections only (not in recommendations/ads)
    // Match patterns like: "print_length">561</span> or ページ数</th>...<td>123ページ
    const printLenMatch = html.match(
      /print_length[^>]*>\s*(\d+)/i
    );
    if (printLenMatch) {
      const p = parseInt(printLenMatch[1], 10);
      if (p > 0 && p < 100000) totalPages = p;
    }

    // Try detail table: ページ数 header followed by value
    if (!totalPages) {
      const detailMatch = html.match(
        /ページ数\s*<\/[^>]+>\s*<[^>]+>\s*(\d+)/
      );
      if (detailMatch) {
        const p = parseInt(detailMatch[1], 10);
        if (p > 0 && p < 100000) totalPages = p;
      }
    }

    // Validate title
    if (!isValidTitle(title)) {
      return { blocked: false, title: null, author: null, totalPages: null };
    }

    // Try to find author
    const authorMatch = html.match(
      /class="author[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)/
    );
    if (authorMatch) {
      author = authorMatch[1].trim();
    }

    if (!author) {
      const contribMatch = html.match(
        /id="bylineContributor"[^>]*>([^<]+)/
      );
      if (contribMatch) {
        author = contribMatch[1].trim();
      }
    }

    if (!author) {
      const bylineMatch = html.match(
        /id="bylineInfo"[\s\S]*?<a[^>]*>([^<]+)/
      );
      if (bylineMatch) {
        author = bylineMatch[1].trim();
      }
    }

    // Try to find cover image URL
    let coverUrl = null;

    // Main product image (high-res)
    const imgMatch = html.match(
      /id="imgBlkFront"[^>]*src="([^"]+)"/
    );
    if (imgMatch) {
      coverUrl = imgMatch[1];
    }

    // Kindle ebook cover image
    if (!coverUrl) {
      const ebookImgMatch = html.match(
        /id="ebooksImgBlkFront"[^>]*src="([^"]+)"/
      );
      if (ebookImgMatch) {
        coverUrl = ebookImgMatch[1];
      }
    }

    // data-a-dynamic-image (JSON object with image URLs as keys)
    if (!coverUrl) {
      const dynamicMatch = html.match(
        /id="(?:imgBlkFront|ebooksImgBlkFront|landingImage)"[^>]*data-a-dynamic-image="([^"]+)"/
      );
      if (dynamicMatch) {
        try {
          const decoded = dynamicMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
          const imgObj = JSON.parse(decoded);
          // Pick the largest image
          let bestUrl = null;
          let bestSize = 0;
          for (const [url, dims] of Object.entries(imgObj)) {
            const size = Array.isArray(dims) ? dims[0] * dims[1] : 0;
            if (size > bestSize) {
              bestSize = size;
              bestUrl = url;
            }
          }
          if (bestUrl) coverUrl = bestUrl;
        } catch {
          // ignore parse errors
        }
      }
    }

    // og:image meta tag as fallback
    if (!coverUrl) {
      const ogImgMatch = html.match(
        /property="og:image"\s+content="([^"]+)"/
      );
      if (ogImgMatch) {
        const ogImg = ogImgMatch[1];
        // Skip generic Amazon logos
        if (!ogImg.includes("amazon_logo") && !ogImg.includes("no-img")) {
          coverUrl = ogImg;
        }
      }
    }

    return { blocked: false, title, author, totalPages, coverUrl };
  } catch (error) {
    console.error(`  エラー (${asin}): ${error.message}`);
    return { blocked: false, title: null, author: null, totalPages: null, coverUrl: null };
  }
}

async function main() {
  const args = parseArgs();

  const data = JSON.parse(fs.readFileSync(BOOKS_JSON_PATH, "utf-8"));
  const books = data.books;

  const targets = args.all
    ? books.filter((b) => b.asin)
    : args.covers
      ? books.filter((b) => b.asin && !b.coverUrl)
      : books.filter(
          (b) =>
            b.asin &&
            (!b.title ||
              b.title.startsWith("不明") ||
              b.title === "Amazon.co.jp" ||
              !b.author)
        );

  console.log(`対象: ${targets.length}冊`);
  console.log(`待機時間: ${args.delay}ms`);
  if (args.dryRun) console.log("(ドライラン: 変更は保存されません)");
  console.log();

  let updated = 0;
  let failed = 0;
  let blocked = 0;
  let consecutiveBlocks = 0;

  for (let i = 0; i < targets.length; i++) {
    const book = targets[i];
    process.stdout.write(
      `[${i + 1}/${targets.length}] ${book.asin} ... `
    );

    const result = await fetchTitleFromAmazon(book.asin);

    if (result.blocked) {
      console.log("ブロックされました（待機時間を延長）");
      blocked++;
      consecutiveBlocks++;

      // Exponential backoff on consecutive blocks
      if (consecutiveBlocks >= 5) {
        console.log();
        console.log(
          `連続${consecutiveBlocks}回ブロックされたため中断します。`
        );
        console.log(
          "時間をおいてから再実行するか、--delay を大きくしてください。"
        );
        console.log(`例: node scripts/fetch-titles.mjs --delay 5000`);
        break;
      }

      const backoff = args.delay * Math.pow(2, consecutiveBlocks);
      console.log(`  ${Math.round(backoff / 1000)}秒待機中...`);
      await sleep(backoff);
      // Retry this same book
      i--;
      continue;
    }

    consecutiveBlocks = 0;

    if (result.title && isValidTitle(result.title)) {
      book.title = result.title;
      if (result.author && !book.author) {
        book.author = result.author;
      }
      if (result.totalPages && !book.totalPages) {
        book.totalPages = result.totalPages;
      }
      if (result.coverUrl && !book.coverUrl) {
        book.coverUrl = result.coverUrl;
      }
      console.log(result.title);
      if (result.author) console.log(`  著者: ${result.author}`);
      if (result.totalPages) console.log(`  ページ数: ${result.totalPages}`);
      if (result.coverUrl) console.log(`  表紙: 取得済み`);
      updated++;
    } else if (result.coverUrl && !book.coverUrl) {
      // Even if title extraction failed, save cover if found
      book.coverUrl = result.coverUrl;
      console.log(`表紙のみ取得`);
      updated++;
    } else {
      console.log("取得失敗");
      failed++;
    }

    // Rate limiting
    if (i < targets.length - 1) {
      await sleep(args.delay);
    }
  }

  console.log();
  console.log(
    `結果: 更新 ${updated}冊, 失敗 ${failed}冊, ブロック ${blocked}回`
  );

  if (!args.dryRun && updated > 0) {
    fs.writeFileSync(BOOKS_JSON_PATH, JSON.stringify(data, null, 2) + "\n");
    console.log(`${BOOKS_JSON_PATH} を更新しました`);
  }

  const remaining = targets.filter(
    (b) =>
      !b.title ||
      b.title.startsWith("不明") ||
      b.title === "Amazon.co.jp" ||
      !b.author
  ).length;
  if (remaining > 0) {
    console.log();
    console.log(
      `まだ${remaining}冊のタイトルが未取得です。時間をおいて再実行してください。`
    );
  }
}

main();
