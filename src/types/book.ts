export interface ReadingSession {
  date: string;
  currentPage?: number;
  currentPercent?: number;
  readingTimeMinutes?: number;
  round?: number;
}

export interface ComputedSession {
  date: string;
  currentPage?: number;
  currentPercent?: number;
  pagesRead?: number;
  percentRead?: number;
  readingTimeMinutes?: number;
  round: number;
}

export interface BookData {
  id: string;
  title: string;
  author: string;
  isbn?: string;
  coverUrl?: string;
  totalPages?: number;
  progressType: "page" | "percent";
  sessions: ReadingSession[];
}

export interface Book extends BookData {
  resolvedCoverUrl: string;
  lastReadDate: string;
  currentPage?: number;
  currentPercent?: number;
  currentRound: number;
  totalReadingTimeMinutes: number;
  computedSessions: ComputedSession[];
}
