import type { Grants } from '../modules/authorization/authorization.service.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware once the access token, user and session are validated. */
      auth?: {
        userId: string;
        sessionId: string;
        /** Organization stored on the session by POST /me/active-organization, if any. */
        activeOrganizationId?: string;
      };
      /** Set by `organizationContext` after validating organization status and membership. */
      org?: {
        organizationId: string;
        membershipId: string;
        roleIds: string[];
        /** The caller's organization units (departments, classes, sections), for relative scopes. */
        unitIds: string[];
      };
      /** Memoized by the permission guard (see requestGrants). */
      grants?: { organization?: Grants; platform?: Grants };
    }
  }
}

export {};
