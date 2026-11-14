import { createBrowserRouter } from 'react-router';
import { ALL_NAV_ITEMS } from '@/config/navigation';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { BrandPage } from '@/pages/BrandPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ModulePlaceholderPage } from '@/pages/ModulePlaceholderPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SignInPage } from '@/pages/SignInPage';

// Modules without screens yet render a placeholder. Replace entries as features land.
const moduleRoutes = ALL_NAV_ITEMS.filter((item) => item.path !== '/').map((item) => ({
  path: `${item.path.slice(1)}/*`,
  element: <ModulePlaceholderPage />,
}));

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [{ path: 'sign-in', element: <SignInPage /> }],
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'brand', element: <BrandPage /> },
      ...moduleRoutes,
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
