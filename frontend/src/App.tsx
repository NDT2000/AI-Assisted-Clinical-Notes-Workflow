import { Route, Routes } from 'react-router-dom'
import { NotesPage } from './features/notes/pages/NotesPage';
import { NoteDetailPage } from './features/notes/pages/NoteDetailPage';

import './App.css'

function App() {

  return (
    <Routes>
      <Route path="/" element={<NotesPage />} />
      <Route path="/notes" element={<NotesPage />} />
      <Route path="/notes/:noteId" element={<NoteDetailPage />} />
    </Routes>
  );
}

export default App
