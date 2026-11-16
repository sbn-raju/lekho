import { AppShell, Avatar, Burger, Group, Menu, NavLink, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconBuildingCommunity, IconCheck, IconChevronDown, IconLogout, IconShieldCheck, IconWorld } from '@tabler/icons-react';
import { Suspense } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { PageLoader } from '@/components/feedback/QueryState';
import { Logo } from '@/components/brand/Logo';
import { notifyError } from '@/components/feedback/feedback';
import { ACCOUNT_ITEM, PLATFORM_NAV, SCHOOL_FOOTER_NAV, SCHOOL_NAV, type NavItem, type NavSection } from '@/config/navigation';
import { useApiHealth } from '@/hooks/useApiHealth';
import { useAccess, useMyMemberships, useSelectOrganization } from '@/services/api/access';
import { useAuth, useCurrentUser } from '@/services/auth/auth-context';
import { useActiveOrganizationId } from '@/services/auth/organization-context';
import { fullName, initials } from '@/utils/format';
import classes from './AppLayout.module.css';

function isActive(pathname: string, path: string, root: string) {
  return path === root ? pathname === root : pathname === path || pathname.startsWith(`${path}/`);
}

function SidebarLink({ item, root, onNavigate }: { item: NavItem; root: string; onNavigate: () => void }) {
  const { pathname } = useLocation();
  const Icon = item.icon;
  return (
    <NavLink
      component={Link}
      to={item.path}
      label={item.label}
      leftSection={<Icon size={20} stroke={1.75} />}
      active={isActive(pathname, item.path, root)}
      onClick={onNavigate}
      className={classes.link}
    />
  );
}

function ApiStatus() {
  const health = useApiHealth();
  const tone = health.state === 'online' ? 'success' : health.state === 'offline' ? 'error' : 'neutral';
  const label = health.state === 'online' ? `API online · DB ${health.data.database}` : health.state === 'offline' ? 'API offline' : 'Checking API…';
  return (
    <Group gap={8} px="xs" wrap="nowrap">
      <span className={classes.dot} style={{ background: `var(--mantine-color-${tone}-6)` }} />
      <Text size="xs" c="dimmed" truncate>
        {label}
      </Text>
    </Group>
  );
}

/** Header control to switch between the user's schools and the platform console. */
function WorkspaceSwitcher({ variant }: { variant: 'school' | 'platform' }) {
  const navigate = useNavigate();
  const access = useAccess();
  const memberships = useMyMemberships();
  const activeId = useActiveOrganizationId();
  const select = useSelectOrganization();
  const usable = memberships.data?.filter((m) => m.usable) ?? [];
  const current = variant === 'platform' ? 'Lekho platform' : (usable.find((m) => m.organizationId === activeId)?.organization.name ?? 'Select a school');

  if (usable.length + (access.hasPlatformAccess ? 1 : 0) <= 1) {
    return (
      <Text fw={600} size="md" truncate maw={260}>
        {current}
      </Text>
    );
  }

  return (
    <Menu position="bottom-start" width={280} shadow="md">
      <Menu.Target>
        <UnstyledButton aria-label="Switch workspace">
          <Group gap={6} wrap="nowrap">
            <Text fw={600} size="md" truncate maw={240}>
              {current}
            </Text>
            <IconChevronDown size={16} stroke={1.75} />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {usable.length > 0 && <Menu.Label>Schools</Menu.Label>}
        {usable.map((m) => (
          <Menu.Item
            key={m.organizationId}
            leftSection={<IconBuildingCommunity size={16} />}
            rightSection={variant === 'school' && m.organizationId === activeId ? <IconCheck size={16} /> : null}
            onClick={() =>
              select.mutate(m.organizationId, { onSuccess: () => navigate('/'), onError: (e) => notifyError(e) })
            }
          >
            {m.organization.name}
          </Menu.Item>
        ))}
        {access.hasPlatformAccess && (
          <>
            <Menu.Divider />
            <Menu.Item leftSection={<IconWorld size={16} />} rightSection={variant === 'platform' ? <IconCheck size={16} /> : null} onClick={() => navigate('/platform')}>
              Lekho platform console
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

function filterNav(sections: NavSection[], allowed: (code: string) => boolean): NavSection[] {
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.permission || allowed(i.permission)) }))
    .filter((s) => s.items.length > 0);
}

/**
 * Console shell shared by the School Administration Console and the Super Admin Console.
 * Navigation is filtered by the user's permissions (a UI hint; the API enforces access).
 */
export function AppLayout({ variant = 'school' }: { variant?: 'school' | 'platform' }) {
  const [opened, { toggle, close }] = useDisclosure();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const user = useCurrentUser();
  const access = useAccess();

  const root = variant === 'platform' ? '/platform' : '/';
  const sections = variant === 'platform' ? filterNav(PLATFORM_NAV, access.canPlatform) : filterNav(SCHOOL_NAV, access.canOrg);
  const footer = variant === 'platform' ? [] : SCHOOL_FOOTER_NAV;
  const accountPath = variant === 'platform' ? '/platform/account/security' : ACCOUNT_ITEM.path;

  const signOut = async () => {
    await logout();
    navigate('/sign-in', { replace: true });
  };

  return (
    <AppShell header={{ height: 64 }} navbar={{ width: 264, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="lg">
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="nowrap" miw={0}>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <UnstyledButton component={Link} to={root} aria-label="Lekho home">
              <Logo size={30} />
            </UnstyledButton>
            <WorkspaceSwitcher variant={variant} />
          </Group>

          <Menu position="bottom-end" width={240} shadow="md">
            <Menu.Target>
              <UnstyledButton aria-label="Account menu">
                <Avatar color="lekho" radius="xl" size={36}>
                  {initials(user)}
                </Avatar>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>
                <Text size="sm" fw={600} c="var(--lekho-text)" truncate>
                  {fullName(user)}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {user.email}
                </Text>
              </Menu.Label>
              <Menu.Item leftSection={<IconShieldCheck size={16} />} onClick={() => navigate(accountPath)}>
                Account security
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="error" leftSection={<IconLogout size={16} />} onClick={() => void signOut()}>
                Sign out
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className={classes.navbar}>
        <AppShell.Section grow component={ScrollArea} px="sm" py="md">
          <Stack gap="md">
            {sections.map((section, i) => (
              <Stack key={section.title ?? i} gap={2}>
                {section.title && (
                  <Text size="xs" c="dimmed" fw={600} px="xs" mb={4}>
                    {section.title}
                  </Text>
                )}
                {section.items.map((item) => (
                  <SidebarLink key={item.path} item={item} root={root} onNavigate={close} />
                ))}
              </Stack>
            ))}
          </Stack>
        </AppShell.Section>

        <AppShell.Section px="sm" py="sm" className={classes.navFooter}>
          {footer.map((item) => (
            <SidebarLink key={item.path} item={item} root={root} onNavigate={close} />
          ))}
          <ApiStatus />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </AppShell.Main>
    </AppShell>
  );
}
