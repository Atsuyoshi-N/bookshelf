import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllBooks, getBookById } from "@/lib/books";
import { ComputedSession } from "@/types/book";

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

function groupByRound(sessions: ComputedSession[]): Map<number, ComputedSession[]> {
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

  const progressBar = isPercent
    ? book.currentPercent ?? 0
    : book.totalPages && book.currentPage
      ? Math.min(100, (book.currentPage / book.totalPages) * 100)
      : null;

  return (
    <div>
      <Link
        href="/"
        className="inline-flex items-center text-sm text-accent hover:underline mb-6"
      >
        &larr; 本棚に戻る
      </Link>

      <div className="flex flex-col md:flex-row gap-8">
        <div className="shrink-0">
          <div className="relative w-48 aspect-[2/3] rounded-lg overflow-hidden shadow-md bg-gray-100 dark:bg-gray-800">
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
            <p className="text-sm text-muted mb-4">ISBN: {book.isbn}</p>
          )}

          <div className="flex gap-6 mb-6">
            <div>
              <p className="text-sm text-muted">現在の進捗</p>
              <p className="text-xl font-bold">
                {isPercent ? (
                  <>{book.currentPercent ?? 0}%</>
                ) : (
                  <>
                    {book.currentPage ?? 0}
                    {book.totalPages && (
                      <span className="text-sm font-normal text-muted">
                        {" "}
                        / {book.totalPages}ページ
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
                <span>進捗（{book.currentRound}周目）</span>
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
                <div className="bg-card-bg border border-card-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-card-border">
                        <th className="text-left px-4 py-3 font-medium">
                          日付
                        </th>
                        <th className="text-right px-4 py-3 font-medium">
                          読んだ範囲
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
                                    ? formatReadingTime(session.readingTimeMinutes)
                                    : "-"}
                                </td>
                              )}
                            </tr>
                          );
                        }

                        const prev =
                          index < sessions.length - 1
                            ? sessions[index + 1].currentPage ?? 0
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
                              p.{prev + 1} → p.{session.currentPage}
                            </td>
                            <td className="text-right px-4 py-3">
                              {session.pagesRead}ページ
                            </td>
                            {hasReadingTime && (
                              <td className="text-right px-4 py-3 text-muted">
                                {session.readingTimeMinutes
                                  ? formatReadingTime(session.readingTimeMinutes)
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
