import { Controller, Get, Next, Post, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import * as passport from 'passport';
import { AuthenticatedUser } from './google.strategy';

// No trailing slash per the task brief's APP_ORIGIN contract.
const APP_ORIGIN = process.env.APP_ORIGIN ?? '';
const SESSION_COOKIE_NAME = 'chatty.sid';

// Registered at @Controller('auth') -> resolves to /auth/google,
// /auth/google/callback, /auth/logout, all WITHOUT the /api prefix
// because they match main.ts's frozen setGlobalPrefix exclude pattern
// '/auth/{*splat}' (verified empirically). GET /api/auth/me can't be
// produced this way (see me-route.registrar.ts for why) so it isn't a
// route on this controller.
//
// No @nestjs/passport in this project's deps, so passport is driven
// directly via passport.authenticate(...)(req, res, next) rather than
// PassportStrategy/AuthGuard('google').
@Controller('auth')
export class AuthController {
  @Get('google')
  google(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction): void {
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      session: false,
    })(req, res, next);
  }

  @Get('google/callback')
  googleCallback(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction): void {
    passport.authenticate(
      'google',
      { session: false },
      (err: unknown, user: AuthenticatedUser | false) => {
        if (err) {
          next(err);
          return;
        }
        if (!user) {
          // Strategy failed: not on the allowlist, or Google itself
          // denied/errored. No session created — see
          // google.strategy.ts's googleVerifyCallback.
          res.redirect(`${APP_ORIGIN}/login`);
          return;
        }

        // A<->B seam (see main.ts): accountId is the field workstream A
        // reads. authUser backs GET /api/auth/me.
        req.session.accountId = String(user.id);
        req.session.authUser = {
          email: user.email,
          name: user.name,
          picture: user.picture,
        };
        req.session.save((saveErr) => {
          if (saveErr) {
            next(saveErr);
            return;
          }
          res.redirect(APP_ORIGIN || '/');
        });
      },
    )(req, res, next);
  }

  @Post('logout')
  logout(@Req() req: Request, @Res() res: Response): void {
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE_NAME);
      res.status(204).end();
    });
  }
}
