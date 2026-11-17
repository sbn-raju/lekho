import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { RouterProvider } from 'react-router';
import { QueryProvider } from '@/app/providers/QueryProvider';
import { router } from '@/router';
import { AuthProvider } from '@/services/auth/AuthProvider';
import { cssVariablesResolver, theme } from '@/theme/theme';

export default function App() {
  return (
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="light">
      <QueryProvider>
        <AuthProvider>
          <ModalsProvider>
            <Notifications position="top-right" />
            <RouterProvider router={router} />
          </ModalsProvider>
        </AuthProvider>
      </QueryProvider>
    </MantineProvider>
  );
}
