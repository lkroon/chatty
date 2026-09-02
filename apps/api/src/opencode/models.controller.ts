import { Controller, Get } from '@nestjs/common';
import type { Model } from '@contracts/model';
import { OpencodeService } from './opencode.service';
import { isToolCapableModel } from '../chat/tool-capable-models';

// GET /api/models — see opencode.module.ts. Registered without the /api
// prefix; app.setGlobalPrefix('api') in main.ts (owned by another
// workstream) adds it.
@Controller('models')
export class ModelsController {
  constructor(private readonly opencodeService: OpencodeService) {}

  @Get()
  getModels(): Model[] {
    // toolCapable is stamped here, not cached on OpencodeService's model
    // list — it depends on WEB_SEARCH_ENABLED/TOOL_CAPABLE_MODELS, not on
    // anything the upstream /models fetch itself returns.
    return this.opencodeService
      .getModels()
      .map((model) => ({ ...model, toolCapable: isToolCapableModel(model.id) }));
  }
}
