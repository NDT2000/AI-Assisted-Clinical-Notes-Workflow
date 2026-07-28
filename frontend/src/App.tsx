import { Navigate, Route, Routes } from 'react-router-dom'
import NotesListPage from './pages/NotesListPage'
import NotesDetailsPage from './pages/NotesDetailsPage'

import './App.css'

function App() {

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/notes" replace />} />
      <Route path="/notes" element={<NotesListPage />} />
      <Route path="/notes/:noteId" element={<NotesDetailsPage />} />
    </Routes>
  );
}

export default App
