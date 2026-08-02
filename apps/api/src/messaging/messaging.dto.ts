import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
export class CreateAgentPostDto {
  @IsString() @MinLength(1) @MaxLength(20000) content!: string;
  @IsIn(['PUBLIC', 'UNLISTED', 'PRIVATE']) visibility!:
    'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  @IsOptional() @IsObject() structuredPayload?: Record<string, unknown>;
  @IsString() @MinLength(1) @MaxLength(4096) signature!: string;
}
