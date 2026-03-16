import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllBooks, getBookById } from "@/lib/books";
import { ComputedSession } from "@/types/book";

const AMAZON_ASSOCIATE_TAG = process.env.AMAZON_ASSOCIATE_TAG || "";

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatReadingTime(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
}

/** Apply modulo to wrap page number within totalPages */
function wrapPage(page: number, totalPages: number | undefined): number {
  if (!totalPages || totalPages <= 0) return page;
  if (page <= 0) return 0;
  return ((page - 1) % totalPages) + 1;
}

export async function generateStaticParams() {
  const books = await getAllBooks();
  return books.map((book) => ({ id: book.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const book = await getBookById(id);
  if (!book) return { title: "Not Found" };
  return {
    title: `${book.title} - My Kindle Bookshelf`,
    description: `${book.author}の「${book.title}」の読書記録`,
  };
}

function groupByRound(
  sessions: ComputedSession[]
): Map<number, ComputedSession[]> {
  const map = new Map<number, ComputedSession[]>();
  for (const s of sessions) {
    const list = map.get(s.round) ?? [];
    list.push(s);
    map.set(s.round, list);
  }
  return map;
}

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const book = await getBookById(id);

  if (!book) {
    notFound();
  }

  const isPercent = book.progressType === "percent";
  const roundGroups = groupByRound(book.computedSessions);
  const rounds = Array.from(roundGroups.keys()).sort((a, b) => b - a);

  const effectiveCurrentPage = book.currentPage
    ? wrapPage(book.currentPage, book.totalPages)
    : 0;

  const progressBar = isPercent
    ? book.currentPercent ?? 0
    : book.totalPages && book.currentPage
      ? Math.min(100, (effectiveCurrentPage / book.totalPages) * 100)
      : null;

  return (
    <div>
      <Link
        href="/"
        className="inline-flex items-center text-sm text-accent hover:underline mb-6"
      >
        &larr; 本棚に戻る
      </Link>

      <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
        <div className="shrink-0 flex justify-center sm:justify-start">
          <div className="relative w-36 sm:w-48 aspect-[2/3] rounded-lg overflow-hidden shadow-md bg-gray-100 dark:bg-gray-800">
            <Image
              src={book.resolvedCoverUrl}
              alt={book.title}
              fill
              className="object-contain"
              sizes="192px"
            />
          </div>
        </div>

        <div className="flex-1">
          <h1 className="text-2xl font-bold mb-2">{book.title}</h1>
          <p className="text-muted mb-1">{book.author}</p>
          {book.isbn && (
            <p className="text-sm text-muted mb-2">ISBN: {book.isbn}</p>
          )}
          {book.asin && (
            <p className="mb-4">
              <a
                href={`https://www.amazon.co.jp/dp/${book.asin}${AMAZON_ASSOCIATE_TAG ? `?tag=${AMAZON_ASSOCIATE_TAG}` : ""}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
              >
                Amazonで見る
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </p>
          )}

          <div className="flex flex-wrap gap-6 mb-6">
            <div>
              <p className="text-sm text-muted">現在の進捗</p>
              <p className="text-xl font-bold">
                {isPercent ? (
                  <>{book.currentPercent ?? 0}%</>
                ) : (
                  <>
                    {effectiveCurrentPage}
                    {book.totalPages && (
                      <span className="text-sm font-normal text-muted">
                        {" "}
                        / {book.totalPages}ページ
                      </span>
                    )}
                    {!book.totalPages && (
                      <span className="text-sm font-normal text-muted">
                        ページ
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted">読書回数</p>
              <p className="text-xl font-bold">
                {book.computedSessions.length}回
              </p>
            </div>
            {book.totalReadingTimeMinutes > 0 && (
              <div>
                <p className="text-sm text-muted">総読書時間</p>
                <p className="text-xl font-bold">
                  {formatReadingTime(book.totalReadingTimeMinutes)}
                </p>
              </div>
            )}
            {book.totalPages && (
              <div>
                <p className="text-sm text-muted">総ページ数</p>
                <p className="text-xl font-bold">{book.totalPages}</p>
              </div>
            )}
            {book.currentRound > 1 && (
              <div>
                <p className="text-sm text-muted">現在</p>
                <p className="text-xl font-bold">{book.currentRound}周目</p>
              </div>
            )}
          </div>

          {progressBar !== null && (
            <div className="mb-6">
              <div className="flex justify-between text-sm text-muted mb-1">
                <span>進捗{book.currentRound > 1 ? `（${book.currentRound}周目）` : ""}</span>
                <span>{Math.round(progressBar)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                <div
                  className="bg-accent rounded-full h-2.5 transition-all"
                  style={{ width: `${progressBar}%` }}
                />
              </div>
            </div>
          )}

          <h2 className="text-lg font-semibold mb-3">読書セッション</h2>

          {rounds.map((round) => {
            const sessions = [...(roundGroups.get(round) ?? [])].reverse();
            const hasReadingTime = sessions.some(
              (s) => s.readingTimeMinutes && s.readingTimeMinutes > 0
            );
            return (
              <div key={round} className="mb-6">
                {rounds.length > 1 && (
                  <h3 className="text-sm font-medium text-muted mb-2">
                    {round}周目
                  </h3>
                )}
                <div className="bg-card-bg border border-card-border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[400px]">
                    <thead>
                      <tr className="border-b border-card-border">
                        <th className="text-left px-4 py-3 font-medium">
                          日付
                        </th>
                        <th className="text-right px-4 py-3 font-medium">
                          <span className="inline-flex items-center gap-1">
                            読んだ範囲
                            <span
                              className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-current text-[10px] leading-none cursor-help opacity-60"
                              title="ページめくり数の累計から算出した推定値です。戻る操作等により実際のページ番号とは異なる場合があります。"
                            >
                              i
                            </span>
                          </span>
                        </th>
                        <th className="text-right px-4 py-3 font-medium">
                          {isPercent ? "進んだ割合" : "読んだページ数"}
                        </th>
                        {hasReadingTime && (
                          <th className="text-right px-4 py-3 font-medium">
                            読書時間
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((session, index) => {
                        if (isPercent) {
                          const prev =
                            index < sessions.length - 1
                              ? sessions[index + 1].currentPercent ?? 0
                              : 0;
                          return (
                            <tr
                              key={`${round}-${session.date}`}
                              className="border-b border-card-border last:border-b-0"
                            >
                              <td className="px-4 py-3">
                                {formatDate(session.date)}
                              </td>
                              <td className="text-right px-4 py-3 text-muted">
                                {prev}% → {session.currentPercent}%
                              </td>
                              <td className="text-right px-4 py-3">
                                +{session.percentRead}%
                              </td>
                              {hasReadingTime && (
                                <td className="text-right px-4 py-3 text-muted">
                                  {session.readingTimeMinutes
                                    ? formatReadingTime(
                                        session.readingTimeMinutes
                                      )
                                    : "-"}
                                </td>
                              )}
                            </tr>
                          );
                        }

                        const rawPrev =
                          index < sessions.length - 1
                            ? sessions[index + 1].currentPage ?? 0
                            : 0;
                        const rawCurrent = session.currentPage ?? 0;

                        const prevPage = wrapPage(
                          rawPrev,
                          book.totalPages
                        );
                        const currentPage = wrapPage(
                          rawCurrent,
                          book.totalPages
                        );
                        const pagesRead = session.pagesRead ?? 0;

                        return (
                          <tr
                            key={`${round}-${session.date}`}
                            className="border-b border-card-border last:border-b-0"
                          >
                            <td className="px-4 py-3">
                              {formatDate(session.date)}
                            </td>
                            <td className="text-right px-4 py-3 text-muted">
                              p.{prevPage + 1} → p.{currentPage}
                            </td>
                            <td className="text-right px-4 py-3">
                              {pagesRead}ページ
                            </td>
                            {hasReadingTime && (
                              <td className="text-right px-4 py-3 text-muted">
                                {session.readingTimeMinutes
                                  ? formatReadingTime(
                                      session.readingTimeMinutes
                                    )
                                  : "-"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
