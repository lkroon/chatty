import { Controller, Get, HttpCode } from '@nestjs/common';

// Unauthenticated liveness/readiness probes. Routes are registered
// outside the global 'api' prefix via app.setGlobalPrefix's `exclude`
// option in main.ts, so these resolve at /healthz and /readyz (not
// /api/healthz). No dependency checks yet for Wave 0.
@Controller()
export class HealthController {
  @Get('healthz')
  @HttpCode(200)
  healthz() {
    return { status: 'ok' };
  }

  @Get('readyz')
  @HttpCode(200)
  readyz() {
    return { status: 'ok' };
  }
}
