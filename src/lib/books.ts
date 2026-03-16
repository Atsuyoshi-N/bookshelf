import fs from "fs";
import path from "path";
import { Book, BookData, ComputedSession } from "@/types/book";
import { fetchCoverUrls } from "./openbd";

const PLACEHOLDER_COVER = "/placeholder-cover.svg";

interface BooksJson {
  books: BookData[];
}

function loadBooksJson(): BookData[] {
  const filePath = path.join(process.cwd(), "data", "books.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const data: BooksJson = JSON.parse(raw);
  return data.books;
}

function computeSessions(book: BookData): ComputedSession[] {
  const sorted = [...book.sessions].sort((a, b) => {
    const roundA = a.round ?? 1;
    const roundB = b.round ?? 1;
    if (roundA !== roundB) return roundA - roundB;
    return a.date < b.date ? -1 : 1;
  });

  const result: ComputedSession[] = [];

  if (book.progressType === "percent") {
    let prevPercent = 0;
    let prevRound = 0;

    for (const session of sorted) {
      const round = session.round ?? 1;
      if (round !== prevRound) {
        prevPercent = 0;
        prevRound = round;
      }
      const current = session.currentPercent ?? 0;
      result.push({
        date: session.date,
        currentPercent: current,
        percentRead: Math.round((current - prevPercent) * 10) / 10,
        readingTimeMinutes: session.readingTimeMinutes,
        round,
      });
      prevPercent = current;
    }
  } else {
    let prevPage = 0;
    let prevRound = 0;

    for (const session of sorted) {
      const round = session.round ?? 1;
      if (round !== prevRound) {
        prevPage = 0;
        prevRound = round;
      }
      const current = session.currentPage ?? 0;
      result.push({
        date: session.date,
        currentPage: current,
        pagesRead: current - prevPage,
        readingTimeMinutes: session.readingTimeMinutes,
        round,
      });
      prevPage = current;
    }
  }

  return result;
}

export async function getAllBooks(): Promise<Book[]> {
  const booksData = loadBooksJson();

  const isbns = booksData
    .filter((b) => b.isbn)
    .map((b) => b.isbn as string);

  const coverMap = await fetchCoverUrls(isbns);

  const books: Book[] = booksData.map((bookData) => {
    const resolvedCoverUrl =
      bookData.coverUrl ||
      (bookData.isbn ? coverMap.get(bookData.isbn) : undefined) ||
      PLACEHOLDER_COVER;

    const computedSessions = computeSessions(bookData);
    const lastSession =
      computedSessions.length > 0
        ? computedSessions[computedSessions.length - 1]
        : null;

    const currentRound = lastSession?.round ?? 1;

    const totalReadingTimeMinutes = computedSessions.reduce(
      (sum, s) => sum + (s.readingTimeMinutes ?? 0),
      0
    );

    return {
      ...bookData,
      resolvedCoverUrl,
      lastReadDate: lastSession?.date ?? "",
      currentPage: lastSession?.currentPage,
      currentPercent: lastSession?.currentPercent,
      currentRound,
      totalReadingTimeMinutes,
      computedSessions,
    };
  });

  books.sort((a, b) => (a.lastReadDate > b.lastReadDate ? -1 : 1));

  return books;
}

export async function getBookById(id: string): Promise<Book | undefined> {
  const books = await getAllBooks();
  return books.find((b) => b.id === id);
}
