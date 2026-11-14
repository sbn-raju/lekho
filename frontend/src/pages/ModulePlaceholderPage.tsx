import { Card, Center, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { useLocation } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { ALL_NAV_ITEMS } from '@/config/navigation';

/** Empty state used for modules that have a route but no screens yet. */
export function ModulePlaceholderPage() {
  const { pathname } = useLocation();
  const item = ALL_NAV_ITEMS.find((i) => i.path !== '/' && pathname.startsWith(i.path));
  const Icon = item?.icon;
  const title = item?.label ?? 'Module';

  return (
    <>
      <PageHeader title={title} />
      <Card py={48}>
        <Center>
          <Stack align="center" gap="sm" maw={420} ta="center">
            {Icon && (
              <ThemeIcon variant="light" size={56} radius="lg">
                <Icon size={28} stroke={1.75} />
              </ThemeIcon>
            )}
            <Title order={3} fz={18}>
              {title} is on its way
            </Title>
            <Text c="dimmed">
              This module hasn't been built yet. Add its screens under <code>src/features</code> and
              register the route in <code>src/router.tsx</code>.
            </Text>
          </Stack>
        </Center>
      </Card>
    </>
  );
}
