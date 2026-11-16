import { OrganizationModel, ORGANIZATION_STATUSES } from '../organizations/organization.model.js';
import { UserModel } from '../users/user.model.js';
import { PlatformMembershipModel } from './platform-membership.model.js';

/** Counts for the Super Admin dashboard (FRD §14.1 screen 1). */
export const platformDashboardService = {
  async summary() {
    const [byStatus, totalUsers, platformStaff] = await Promise.all([
      OrganizationModel.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      UserModel.countDocuments({ status: { $ne: 'deleted' } }),
      PlatformMembershipModel.countDocuments({ status: 'active' }),
    ]);
    const organizations = Object.fromEntries(ORGANIZATION_STATUSES.map((s) => [s, 0])) as Record<(typeof ORGANIZATION_STATUSES)[number], number>;
    for (const row of byStatus) organizations[row._id as keyof typeof organizations] = row.n;
    const total = Object.values(organizations).reduce((a, b) => a + b, 0);
    return {
      organizations: { total, ...organizations },
      pendingOnboarding: organizations.draft + organizations.onboarding,
      totalUsers,
      platformStaff,
    };
  },
};
