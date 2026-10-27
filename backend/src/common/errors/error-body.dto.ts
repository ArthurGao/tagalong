import { ApiProperty } from '@nestjs/swagger';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';

export class ErrorBodyDto {
  @ApiProperty({ enum: Object.keys(ERROR_CODES) })
  code!: ErrorCode;

  @ApiProperty()
  message!: string;

  @ApiProperty({ required: false })
  details?: unknown;
}
