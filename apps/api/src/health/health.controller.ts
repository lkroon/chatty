import { Controller, Get, HttpCode, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/tokens';

// Unauthenticated liveness/readiness probes. Routes are registered
// outside the global 'api' prefix via app.setGlobalPrefix's `exclude`
// option in main.ts, so these resolve at /healthz and /readyz (not
// /api/healthz). No dependency checks yet for Wave 0.
@Controller()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('healthz')
  @HttpCode(200)
  healthz() {
    return { status: 'ok' };
  }

  @Get('readyz')
  @HttpCode(200)
  async readyz() {
    const client = await this.pool.connect();
    try {
      await client.query("SET statement_timeout = '2s'");
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
    return { status: 'ok' };
  }
}
