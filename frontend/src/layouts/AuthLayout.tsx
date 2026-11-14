import { Box, Center, Stack, Text, Title } from '@mantine/core';
import { Outlet } from 'react-router';
import { brandCopy } from '@/brand';
import { Logo } from '@/components/brand/Logo';
import classes from './AuthLayout.module.css';

/**
 * Sign-in / onboarding shell. Guideline: keep the full wordmark on these
 * screens; gradients are reserved for marketing and onboarding surfaces.
 */
export function AuthLayout() {
  return (
    <Box className={classes.root}>
      <Box className={classes.brandPanel} visibleFrom="md">
        <Stack gap="lg" maw={420}>
          <Logo variant="dark-background" size={48} />
          <Title order={1} c="white" fz={32}>
            Manage, teach, learn and grow with Lekho.
          </Title>
          <Text c="lekho.1" size="lg">
            {brandCopy.supportingMessage}
          </Text>
        </Stack>
      </Box>

      <Center className={classes.formPanel}>
        <Box w="100%" maw={400}>
          <Outlet />
        </Box>
      </Center>
    </Box>
  );
}
