import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { UploadView, ProcessingStatusView, TranscriptView, MeetingsListView, SettingsView } from './pages';

// Placeholder components - will be implemented in future tasks
const NotFoundPage = () => <div>404 - Page Not Found</div>;

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Root path redirects to dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <MeetingsListView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/upload"
            element={
              <ProtectedRoute>
                <UploadView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/meetings/:meetingId/status"
            element={
              <ProtectedRoute>
                <ProcessingStatusView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/meetings/:meetingId"
            element={
              <ProtectedRoute>
                <TranscriptView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsView />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
