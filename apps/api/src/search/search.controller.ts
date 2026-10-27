import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SearchHit } from '@contracts/search';
import { SearchService } from './search.service';

// GET /api/search?q= — semantic search over the account's own messages.
// Registered without the /api prefix; app.setGlobalPrefix('api') in
// main.ts adds it.
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(
    @Req() req: Request,
    @Query('q') q?: string,
  ): Promise<SearchHit[]> {
    const accountId = this.requireAccountId(req);
    const query = (q ?? '').trim();
    if (!query) {
      throw new BadRequestException('q is required');
    }
    return this.searchService.search(accountId, query);
  }

  // Same seam as the conversations controller: req.session.accountId is
  // written by the auth flow.
  private requireAccountId(req: Request): string {
    const accountId = req.session?.accountId;
    if (!accountId) {
      throw new UnauthorizedException();
    }
    return accountId;
  }
}
