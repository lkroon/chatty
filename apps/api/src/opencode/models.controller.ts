import { Controller, Get } from '@nestjs/common';
import type { Model } from '@contracts/model';
import { OpencodeService } from './opencode.service';

// GET /api/models — see opencode.module.ts. Registered without the /api
// prefix; app.setGlobalPrefix('api') in main.ts (owned by another
// workstream) adds it.
@Controller('models')
export class ModelsController {
  constructor(private readonly opencodeService: OpencodeService) {}

  @Get()
  getModels(): Model[] {
    return this.opencodeService.getModels();
  }
}
