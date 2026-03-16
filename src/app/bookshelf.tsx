"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Book } from "@/types/book";

const STORAGE_KEY = "bookshelf-selected-year";

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getProgress(book: Book): number | null {
  if (book.progressType === "percent") {
    return book.currentPercent ?? null;
  }
  if (book.totalPages && book.currentPage) {
    // Modulo for re-reads: page flips can exceed totalPages
    const effectivePage = ((book.currentPage - 1) % book.totalPages) + 1;
    return Math.min(100, (effectivePage / book.totalPages) * 100);
  }
  return null;
}

function getProgressLabel(book: Book): string {
  if (book.progressType === "percent") {
    return `${book.currentPercent ?? 0}%`;
  }
  if (book.totalPages && book.currentPage) {
    const effectivePage = ((book.currentPage - 1) % book.totalPages) + 1;
    return `${effectivePage} / ${book.totalPages}ページ`;
  }
  return `${book.currentPage ?? 0}ページ`;
}

function readStoredYear(): number | null | undefined {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === null) return undefined; // no stored value
    if (stored === "all") return null; // "すべて"
    const year = parseInt(stored, 10);
    return isNaN(year) ? undefined : year;
  } catch {
    return undefined;
  }
}

export function BookShelf({ books }: { books: Book[] }) {
  const allYears = useMemo(() => {
    const years = new Set<number>();
    for (const book of books) {
      for (const s of book.sessions) {
        years.add(new Date(s.date).getFullYear());
      }
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [books]);

  const [selectedYear, setSelectedYear] = useState<number | null>(() => {
    const stored = readStoredYear();
    if (stored === undefined) return allYears[0] ?? null;
    if (stored === null) return null;
    return allYears.includes(stored) ? stored : allYears[0] ?? null;
  });

  const handleYearChange = useCallback((year: number | null) => {
    setSelectedYear(year);
    try {
      sessionStorage.setItem(STORAGE_KEY, year === null ? "all" : String(year));
    } catch {
      // sessionStorage unavailable
    }
  }, []);

  // Sync to sessionStorage on mount (for initial state)
  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        selectedYear === null ? "all" : String(selectedYear)
      );
    } catch {
      // sessionStorage unavailable
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredBooks = useMemo(() => {
    if (selectedYear === null) return books;
    return books.filter((book) =>
      book.sessions.some(
        (s) => new Date(s.date).getFullYear() === selectedYear
      )
    );
  }, [books, selectedYear]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">
        読書記録
        <span className="text-base font-normal text-muted ml-3">
          {filteredBooks.length}冊
        </span>
      </h1>

      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-background/95 backdrop-blur-sm">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => handleYearChange(null)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors shrink-0 ${
              selectedYear === null
                ? "bg-accent text-white"
                : "bg-card-bg border border-card-border text-foreground hover:bg-card-border"
            }`}
          >
            すべて
          </button>
          {allYears.map((year) => (
            <button
              key={year}
              onClick={() => handleYearChange(year)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors shrink-0 ${
                selectedYear === year
                  ? "bg-accent text-white"
                  : "bg-card-bg border border-card-border text-foreground hover:bg-card-border"
              }`}
            >
              {year}年
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5 mt-4">
        {filteredBooks.map((book, index) => {
          const progress = getProgress(book);
          return (
            <Link
              key={book.id}
              href={`/books/${book.id}`}
              className="group block"
            >
              <div className="bg-card-bg border border-card-border rounded-lg overflow-hidden shadow-sm transition-transform duration-200 group-hover:scale-105 group-hover:shadow-md">
                <div className="relative aspect-[2/3] bg-gray-100 dark:bg-gray-800">
                  <Image
                    src={book.resolvedCoverUrl}
                    alt={book.title}
                    fill
                    className="object-contain"
                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
                    priority={index < 10}
                    loading={index < 10 ? undefined : "lazy"}
                  />
                </div>
                <div className="p-2 sm:p-3">
                  <h2 className="text-xs sm:text-sm font-semibold leading-tight line-clamp-2 mb-1">
                    {book.title}
                  </h2>
                  <p className="text-[10px] sm:text-xs text-muted truncate">
                    {book.author}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-[10px] sm:text-xs text-muted">
                      {formatDate(book.lastReadDate)}
                    </p>
                    {book.currentRound > 1 && (
                      <span className="text-[10px] sm:text-xs bg-accent/15 text-accent px-1 sm:px-1.5 py-0.5 rounded">
                        {book.currentRound}周目
                      </span>
                    )}
                  </div>
                  {progress !== null && (
                    <div className="mt-1.5 sm:mt-2">
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 sm:h-1.5">
                        <div
                          className="bg-accent rounded-full h-1 sm:h-1.5 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="text-[10px] sm:text-xs text-muted mt-0.5">
                        {getProgressLabel(book)}
                      </p>
                    </div>
                  )}
                  {progress === null && book.totalPages && (
                    <p className="text-[10px] sm:text-xs text-muted mt-1.5 sm:mt-2">
                      全{book.totalPages}ページ
                    </p>
                  )}
                  {progress === null && !book.totalPages && book.currentPage && (
                    <p className="text-[10px] sm:text-xs text-muted mt-1.5 sm:mt-2">
                      {book.currentPage}ページ読了
                    </p>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
