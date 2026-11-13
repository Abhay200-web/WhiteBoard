import { Navigate, type RouteObject } from 'react-router';

import { PublicOnly, RequireAdmin, RequireAuth } from './auth/guards';
import { AppLayout } from './layouts/AppLayout';
import { SettingsLayout } from './layouts/SettingsLayout';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { ConnectPage } from './pages/ConnectPage';
import { JoinPage } from './pages/JoinPage';
import { LoginPage } from './pages/LoginPage';
import { MembersPage } from './pages/members/MembersPage';
import { HomePage, NotFoundPage } from './pages/misc';
import { NewProjectPage } from './pages/projects/NewProjectPage';
import { ProjectPage } from './pages/projects/ProjectPage';
import { ProjectsPage } from './pages/projects/ProjectsPage';
import { HostSection } from './pages/settings/HostSection';
import { AccountSection, ConnectionSection } from './pages/settings/sections';
import { SetupPage } from './pages/SetupPage';

export const routes: RouteObject[] = [
  { element: <PublicOnly page="setup" />, children: [{ path: '/setup', element: <SetupPage /> }] },
  { element: <PublicOnly page="login" />, children: [{ path: '/login', element: <LoginPage /> }] },
  { element: <PublicOnly page="join" />, children: [{ path: '/join', element: <JoinPage /> }] },
  { path: '/connect', element: <ConnectPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/change-password', element: <ChangePasswordPage /> },
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/projects', element: <ProjectsPage /> },
          { path: '/projects/new', element: <NewProjectPage /> },
          { path: '/projects/:id', element: <ProjectPage /> },
          { element: <RequireAdmin />, children: [{ path: '/members', element: <MembersPage /> }] },
          {
            path: '/settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <Navigate to="account" replace /> },
              { path: 'account', element: <AccountSection /> },
              { path: 'connection', element: <ConnectionSection /> },
              { path: 'host', element: <HostSection /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
