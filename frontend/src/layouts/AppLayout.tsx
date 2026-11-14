import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Group,
  Indicator,
  Menu,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconBell, IconLogout, IconSearch, IconUser } from '@tabler/icons-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { NAV_SECTIONS, SETTINGS_ITEM, type NavItem } from '@/config/navigation';
import { useApiHealth } from '@/hooks/useApiHealth';
import classes from './AppLayout.module.css';

function isActive(pathname: string, path: string) {
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
}

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { pathname } = useLocation();
  const Icon = item.icon;
  return (
    <NavLink
      component={Link}
      to={item.path}
      label={item.label}
      leftSection={<Icon size={20} stroke={1.75} />}
      active={isActive(pathname, item.path)}
      onClick={onNavigate}
      className={classes.link}
    />
  );
}

function ApiStatus() {
  const health = useApiHealth();
  const tone =
    health.state === 'online' ? 'success' : health.state === 'offline' ? 'error' : 'neutral';
  const label =
    health.state === 'online'
      ? `API online · DB ${health.data.database}`
      : health.state === 'offline'
        ? 'API offline'
        : 'Checking API…';

  return (
    <Group gap={8} px="xs" wrap="nowrap">
      <span className={classes.dot} style={{ background: `var(--mantine-color-${tone}-6)` }} />
      <Text size="xs" c="dimmed" truncate>
        {label}
      </Text>
    </Group>
  );
}

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const navigate = useNavigate();

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 264, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label="Toggle navigation"
            />
            <UnstyledButton component={Link} to="/" aria-label="Lekho home">
              <Logo size={30} />
            </UnstyledButton>
          </Group>

          <TextInput
            placeholder="Search students, courses, invoices…"
            leftSection={<IconSearch size={16} />}
            visibleFrom="md"
            w={360}
            aria-label="Search"
          />

          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Notifications">
              <Indicator color="warning" size={8} offset={6} processing={false}>
                <ActionIcon variant="subtle" color="neutral" size="lg" aria-label="Notifications">
                  <IconBell size={20} stroke={1.75} />
                </ActionIcon>
              </Indicator>
            </Tooltip>

            <Menu position="bottom-end" width={200} shadow="md">
              <Menu.Target>
                <UnstyledButton aria-label="Account menu">
                  <Avatar color="lekho" radius="xl" size={36}>
                    AD
                  </Avatar>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Signed in as Administrator</Menu.Label>
                <Menu.Item leftSection={<IconUser size={16} />} onClick={() => navigate('/settings')}>
                  Profile
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="error"
                  leftSection={<IconLogout size={16} />}
                  onClick={() => navigate('/sign-in')}
                >
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className={classes.navbar}>
        <AppShell.Section grow component={ScrollArea} px="sm" py="md">
          <Stack gap="md">
            {NAV_SECTIONS.map((section, i) => (
              <Stack key={section.title ?? i} gap={2}>
                {section.title && (
                  <Text size="xs" c="dimmed" fw={600} px="xs" mb={4}>
                    {section.title}
                  </Text>
                )}
                {section.items.map((item) => (
                  <SidebarLink key={item.path} item={item} onNavigate={close} />
                ))}
              </Stack>
            ))}
          </Stack>
        </AppShell.Section>

        <AppShell.Section px="sm" py="sm" className={classes.navFooter}>
          <SidebarLink item={SETTINGS_ITEM} onNavigate={close} />
          <ApiStatus />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
