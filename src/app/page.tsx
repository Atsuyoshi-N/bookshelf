import { getAllBooks } from "@/lib/books";
import { BookShelf } from "./bookshelf";

export default async function Home() {
  const books = await getAllBooks();

  return <BookShelf books={books} />;
}
