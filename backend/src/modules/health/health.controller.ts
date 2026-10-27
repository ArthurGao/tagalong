import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ type: HealthDto })
  check(): HealthDto {
    return { status: 'ok' };
  }
}
