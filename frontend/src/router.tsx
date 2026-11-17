/* eslint-disable react-refresh/only-export-components -- route table: lazy page bindings plus the router, not a component module */
import { lazy, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router';
import { Gate, RedirectIfAuthenticated, RequireAuth, RequirePlatform, RequireSchool } from '@/app/routes/guards';
import { MODULE_PLACEHOLDERS } from '@/config/navigation';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { ModulePlaceholderPage } from '@/pages/ModulePlaceholderPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

const AcceptInvitationPage = lazy(() => import('@/modules/auth/AcceptInvitationPage').then((m) => ({ default: m.AcceptInvitationPage })));
const ForgotPasswordPage = lazy(() => import('@/modules/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/modules/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const SelectOrganizationPage = lazy(() => import('@/modules/auth/SelectOrganizationPage').then((m) => ({ default: m.SelectOrganizationPage })));
const SignInPage = lazy(() => import('@/modules/auth/SignInPage').then((m) => ({ default: m.SignInPage })));
const VerifyEmailPage = lazy(() => import('@/modules/auth/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })));
const AcademicsOverviewPage = lazy(() => import('@/modules/academics/AcademicsOverviewPage').then((m) => ({ default: m.AcademicsOverviewPage })));
const AcademicYearsPage = lazy(() => import('@/modules/academics/AcademicYearsPage').then((m) => ({ default: m.AcademicYearsPage })));
const ClassesPage = lazy(() => import('@/modules/academics/ClassesPage').then((m) => ({ default: m.ClassesPage })));
const ClassDetailPage = lazy(() => import('@/modules/academics/ClassDetailPage').then((m) => ({ default: m.ClassDetailPage })));
const HierarchyPage = lazy(() => import('@/modules/organization/HierarchyPage').then((m) => ({ default: m.HierarchyPage })));
const InvitationsPage = lazy(() => import('@/modules/organization/InvitationsPage').then((m) => ({ default: m.InvitationsPage })));
const SchoolDashboardPage = lazy(() => import('@/modules/organization/SchoolDashboardPage').then((m) => ({ default: m.SchoolDashboardPage })));
const SchoolSettingsPage = lazy(() => import('@/modules/organization/SchoolSettingsPage').then((m) => ({ default: m.SchoolSettingsPage })));
const UserDetailPage = lazy(() => import('@/modules/organization/UserDetailPage').then((m) => ({ default: m.UserDetailPage })));
const UsersPage = lazy(() => import('@/modules/organization/UsersPage').then((m) => ({ default: m.UsersPage })));
const CreateOrganizationPage = lazy(() => import('@/modules/platform/CreateOrganizationPage').then((m) => ({ default: m.CreateOrganizationPage })));
const OrganizationDetailPage = lazy(() => import('@/modules/platform/OrganizationDetailPage').then((m) => ({ default: m.OrganizationDetailPage })));
const OrganizationsPage = lazy(() => import('@/modules/platform/OrganizationsPage').then((m) => ({ default: m.OrganizationsPage })));
const PermissionCatalogPage = lazy(() => import('@/modules/platform/PermissionCatalogPage').then((m) => ({ default: m.PermissionCatalogPage })));
const PlatformDashboardPage = lazy(() => import('@/modules/platform/PlatformDashboardPage').then((m) => ({ default: m.PlatformDashboardPage })));
const PlatformStaffPage = lazy(() => import('@/modules/platform/PlatformStaffPage').then((m) => ({ default: m.PlatformStaffPage })));
const SecurityPage = lazy(() => import('@/modules/platform/SecurityPage').then((m) => ({ default: m.SecurityPage })));
const AccountSecurityPage = lazy(() => import('@/modules/profile/AccountSecurityPage').then((m) => ({ default: m.AccountSecurityPage })));
const AuditLogPage = lazy(() => import('@/modules/shared/audit/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const RoleDetailPage = lazy(() => import('@/modules/shared/roles/RoleDetailPage').then((m) => ({ default: m.RoleDetailPage })));
const RolesListPage = lazy(() => import('@/modules/shared/roles/RolesListPage').then((m) => ({ default: m.RolesListPage })));
const BrandPage = lazy(() => import('@/pages/BrandPage').then((m) => ({ default: m.BrandPage })));

// Pages are code-split per route; layouts render them inside <Suspense>.
const org = (permission: string, element: ReactNode) => <Gate org={permission}>{element}</Gate>;
const platform = (permission: string, element: ReactNode) => <Gate platform={permission}>{element}</Gate>;

// Domain modules without screens yet render a placeholder.
const moduleRoutes = MODULE_PLACEHOLDERS.map((item) => ({ path: `${item.path.slice(1)}/*`, element: <ModulePlaceholderPage /> }));

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      {
        element: <RedirectIfAuthenticated />,
        children: [
          { path: 'sign-in', element: <SignInPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      // Token links work whether or not someone is signed in.
      { path: 'reset-password', element: <ResetPasswordPage mode="reset" /> },
      { path: 'set-password', element: <ResetPasswordPage mode="setup" /> },
      { path: 'verify-email', element: <VerifyEmailPage /> },
      { path: 'invitations/accept', element: <AcceptInvitationPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: 'select-organization', element: <SelectOrganizationPage /> },

      // Lekho Super Admin Console (FRD §14.1)
      {
        path: 'platform',
        element: <RequirePlatform />,
        children: [
          {
            element: <AppLayout variant="platform" />,
            children: [
              { index: true, element: <PlatformDashboardPage /> },
              { path: 'organizations', element: platform('organizations.read', <OrganizationsPage />) },
              { path: 'organizations/new', element: platform('organizations.create', <CreateOrganizationPage />) },
              { path: 'organizations/:id', element: platform('organizations.read', <OrganizationDetailPage />) },
              { path: 'staff', element: platform('platform_users.read', <PlatformStaffPage />) },
              { path: 'roles', element: platform('platform_roles.read', <RolesListPage key="platform" level="platform" />) },
              { path: 'roles/:id', element: platform('platform_roles.read', <RoleDetailPage key="platform" level="platform" />) },
              { path: 'permissions', element: platform('platform_permissions.read', <PermissionCatalogPage />) },
              { path: 'audit-logs', element: platform('platform_audit.read', <AuditLogPage scope="platform" />) },
              { path: 'security', element: platform('platform_audit.read', <SecurityPage />) },
              { path: 'account/security', element: <AccountSecurityPage /> },
            ],
          },
        ],
      },

      // School Administration Console (FRD §14.2)
      {
        element: <RequireSchool />,
        children: [
          {
            path: '/',
            element: <AppLayout variant="school" />,
            children: [
              { index: true, element: <SchoolDashboardPage /> },
              { path: 'academics', element: org('classes.read', <AcademicsOverviewPage />) },
              { path: 'academics/years', element: org('academic_years.read', <AcademicYearsPage />) },
              { path: 'academics/classes', element: org('classes.read', <ClassesPage />) },
              { path: 'academics/classes/:id', element: org('classes.read', <ClassDetailPage />) },
              { path: 'users', element: org('users.read', <UsersPage />) },
              { path: 'users/:id', element: org('users.read', <UserDetailPage />) },
              { path: 'roles', element: org('roles.read', <RolesListPage key="organization" level="organization" />) },
              { path: 'roles/:id', element: org('roles.read', <RoleDetailPage key="organization" level="organization" />) },
              { path: 'hierarchy', element: org('organization_units.read', <HierarchyPage />) },
              { path: 'invitations', element: org('invitations.read', <InvitationsPage />) },
              { path: 'audit-logs', element: org('audit_logs.read', <AuditLogPage scope="organization" />) },
              { path: 'settings', element: <SchoolSettingsPage /> },
              { path: 'account/security', element: <AccountSecurityPage /> },
              { path: 'brand', element: <BrandPage /> },
              ...moduleRoutes,
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
