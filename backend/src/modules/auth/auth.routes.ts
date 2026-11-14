import { Router } from 'express';
import { authController } from './auth.controller.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { rateLimits } from '../../common/middleware/rate-limit.middleware.js';
import {
  changePasswordSchema,
  emailOnlySchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
  sessionIdParams,
  tokenOnlySchema,
} from './auth.validators.js';

const router = Router();

// Public
router.post('/login', rateLimits.login, validate({ body: loginSchema }), authController.login);
router.post('/refresh', rateLimits.refresh, validate({ body: refreshSchema }), authController.refresh);
router.post('/verify-email', rateLimits.tokenRedemption, validate({ body: tokenOnlySchema }), authController.verifyEmail);
router.post('/resend-verification', rateLimits.emailSending, validate({ body: emailOnlySchema }), authController.resendVerification);
router.post('/forgot-password', rateLimits.emailSending, validate({ body: emailOnlySchema }), authController.forgotPassword);
router.post('/reset-password', rateLimits.tokenRedemption, validate({ body: resetPasswordSchema }), authController.resetPassword);

// Authenticated (Bearer access token; not cookie-authenticated, so no CSRF exposure)
router.post('/logout', authenticate, authController.logout);
router.post('/logout-all', authenticate, authController.logoutAll);
router.get('/me', authenticate, authController.me);
router.post('/change-password', authenticate, rateLimits.changePassword, validate({ body: changePasswordSchema }), authController.changePassword);
router.get('/sessions', authenticate, authController.listSessions);
router.delete('/sessions/:id', authenticate, validate({ params: sessionIdParams }), authController.revokeSession);
router.get('/security', authenticate, authController.security);

export default router;
