import { useParams } from "react-router-dom";

export function NoteDetailPage() {
  const { noteId } = useParams<{
    noteId: string;
  }>();

  return (
    <main>
      <h1>Note Detail</h1>

      <p>Note ID: {noteId}</p>
    </main>
  );
}