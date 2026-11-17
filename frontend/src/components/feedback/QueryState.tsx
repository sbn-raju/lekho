import { Alert, Button, Center, EmptyState, Loader, Skeleton, Stack } from '@mantine/core';
import { IconAlertTriangle, IconLock } from '@tabler/icons-react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/services/api/client';
import { errorMessage } from './feedback';

/** Full-page loader for route transitions and session restore. */
export function PageLoader() {
  return (
    <Center mih="60vh">
      <Loader />
    </Center>
  );
}

/** Inline error with retry. 403/404 get a calmer, specific message. */
export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) {
    return <EmptyState icon={<IconLock size={28} stroke={1.75} />} title="You don't have access to this" description={errorMessage(error)} py="xl" />;
  }
  if (error instanceof ApiError && error.status === 404) {
    return <EmptyState title="Not found" description="It may have been removed, or it belongs to another school." py="xl" />;
  }
  return (
    <Alert color="error" icon={<IconAlertTriangle size={18} />} title="Couldn't load this">
      <Stack gap="xs" align="flex-start">
        {errorMessage(error)}
        {onRetry && (
          <Button size="xs" variant="default" onClick={onRetry}>
            Try again
          </Button>
        )}
      </Stack>
    </Alert>
  );
}

/**
 * Renders `children(data)` once a query has data; otherwise a skeleton or the error.
 * Keeps showing previous data while refetching.
 */
export function QueryBoundary<T>({
  query,
  children,
  skeleton = <Skeleton h={160} radius="lg" />,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  return <>{skeleton}</>;
}
