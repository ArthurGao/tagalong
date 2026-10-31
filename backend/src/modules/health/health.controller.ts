import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

export class HealthDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
  @ApiProperty({ enum: ['development', 'staging', 'production'], description: 'Which deployment answered' }) env!: Env['APP_ENV'];
  @ApiProperty({ description: 'The deployed commit; empty when not deployed by Render' }) release!: string;
}

// Post-deploy checks assert which build answered, not only that something did (RUNBOOK smoke).
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  @ApiOkResponse({ type: HealthDto })
  check(): HealthDto {
    return { status: 'ok', env: this.env.APP_ENV, release: this.env.RENDER_GIT_COMMIT };
  }
}
