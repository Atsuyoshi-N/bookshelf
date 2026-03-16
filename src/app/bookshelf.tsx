"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Book } from "@/types/book";

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
    return Math.min(100, (book.currentPage / book.totalPages) * 100);
  }
  return null;
}

function getProgressLabel(book: Book): string {
  if (book.progressType === "percent") {
    return `${book.currentPercent ?? 0}%`;
  }
  if (book.totalPages) {
    return `${book.currentPage ?? 0} / ${book.totalPages}ページ`;
  }
  return `${book.currentPage ?? 0}ページ`;
}

export function BookShelf({ books }: { books: Book[] }) {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const allYears = useMemo(() => {
    const years = new Set<number>();
    for (const book of books) {
      for (const s of book.sessions) {
        years.add(new Date(s.date).getFullYear());
      }
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [books]);

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
      <h1 className="text-2xl font-bold mb-6">
        読書記録
        <span className="text-base font-normal text-muted ml-3">
          {filteredBooks.length}冊
        </span>
      </h1>

      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setSelectedYear(null)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
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
            onClick={() => setSelectedYear(year)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedYear === year
                ? "bg-accent text-white"
                : "bg-card-bg border border-card-border text-foreground hover:bg-card-border"
            }`}
          >
            {year}年
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
        {filteredBooks.map((book) => {
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
                  />
                </div>
                <div className="p-3">
                  <h2 className="text-sm font-semibold leading-tight line-clamp-2 mb-1">
                    {book.title}
                  </h2>
                  <p className="text-xs text-muted truncate">{book.author}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-xs text-muted">
                      {formatDate(book.lastReadDate)}
                    </p>
                    {book.currentRound > 1 && (
                      <span className="text-xs bg-accent/15 text-accent px-1.5 py-0.5 rounded">
                        {book.currentRound}周目
                      </span>
                    )}
                  </div>
                  {progress !== null && (
                    <div className="mt-2">
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                        <div
                          className="bg-accent rounded-full h-1.5 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted mt-0.5">
                        {getProgressLabel(book)}
                      </p>
                    </div>
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
