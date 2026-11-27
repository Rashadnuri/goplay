import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { I18nProvider } from './i18n/index.tsx';
import { AuthProvider } from './hooks/useAuth.tsx';
import { PrefsEffects } from './hooks/usePrefs.ts';
import { ToastProvider, Loading } from './components/ui.tsx';
import { Layout } from './components/Layout.tsx';
import Home from './pages/Home.tsx';
import Welcome from './pages/Welcome.tsx';

const PlayHub = lazy(() => import('./pages/PlayHub.tsx'));
const LocalGame = lazy(() => import('./pages/LocalGame.tsx'));
const AIGame = lazy(() => import('./pages/AIGame.tsx'));
const Matchmaking = lazy(() => import('./pages/Matchmaking.tsx'));
const Rooms = lazy(() => import('./pages/Rooms.tsx'));
const OnlineGame = lazy(() => import('./pages/OnlineGame.tsx'));
const Tournaments = lazy(() => import('./pages/Tournaments.tsx'));
const TournamentDetail = lazy(() => import('./pages/TournamentDetail.tsx'));
const Learn = lazy(() => import('./pages/Learn.tsx'));
const LessonPage = lazy(() => import('./pages/LessonPage.tsx'));
const Replay = lazy(() => import('./pages/Replay.tsx'));
const Watch = lazy(() => import('./pages/Watch.tsx'));
const Puzzles = lazy(() => import('./pages/Puzzles.tsx'));
const PuzzleSolve = lazy(() => import('./pages/PuzzleSolve.tsx'));
const Joseki = lazy(() => import('./pages/Joseki.tsx'));
const Leaderboard = lazy(() => import('./pages/Leaderboard.tsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.tsx'));
const Friends = lazy(() => import('./pages/Friends.tsx'));
const Messages = lazy(() => import('./pages/Messages.tsx'));
const Settings = lazy(() => import('./pages/Settings.tsx'));
const AuthPage = lazy(() => import('./pages/AuthPage.tsx'));
const Admin = lazy(() => import('./pages/Admin.tsx'));
const NotFound = lazy(() => import('./pages/NotFound.tsx'));

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <ToastProvider>
          <PrefsEffects />
          <BrowserRouter>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="welcome" element={<Welcome />} />
                <Route element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route path="play" element={<PlayHub />} />
                  <Route path="play/local" element={<LocalGame />} />
                  <Route path="play/ai" element={<AIGame />} />
                  <Route path="play/online" element={<Matchmaking />} />
                  <Route path="play/room" element={<Rooms />} />
                  <Route path="join/:code" element={<Rooms />} />
                  <Route path="game/:id" element={<OnlineGame />} />
                  <Route path="replay/:id" element={<Replay />} />
                  <Route path="watch" element={<Watch />} />
                  <Route path="tournaments" element={<Tournaments />} />
                  <Route path="tournaments/:id" element={<TournamentDetail />} />
                  <Route path="learn" element={<Learn />} />
                  <Route path="learn/:slug" element={<LessonPage />} />
                  <Route path="puzzles" element={<Puzzles />} />
                  <Route path="puzzles/:id" element={<PuzzleSolve />} />
                  <Route path="academy" element={<Navigate to="/learn" replace />} />
                  <Route path="academy/joseki" element={<Joseki />} />
                  <Route path="daily" element={<Navigate to="/puzzles" replace />} />
                  <Route path="leaderboard" element={<Leaderboard />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="u/:username" element={<ProfilePage />} />
                  <Route path="friends" element={<Friends />} />
                  <Route path="messages/:userId" element={<Messages />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="auth" element={<AuthPage />} />
                  <Route path="admin" element={<Admin />} />
                  <Route path="home" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
