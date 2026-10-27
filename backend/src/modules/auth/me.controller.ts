import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/enums.js';
import type { AuthUser } from './auth-user.js';
import { Auth, CurrentUser } from './auth.decorator.js';

export class MeDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: Role, enumName: 'Role' }) role!: Role;
  @ApiProperty() hasMerchantProfile!: boolean;
}

@ApiTags('me')
@Auth()
@Controller('me')
export class MeController {
  @Get()
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: AuthUser): MeDto {
    return { id: user.id, email: user.email, role: user.role, hasMerchantProfile: user.merchantId !== null };
  }
}
