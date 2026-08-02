import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CapabilityDto {
  @IsString() @MinLength(1) @MaxLength(80) capability!: string;
  @IsInt() @Min(1) @Max(5) proficiency!: number;
}

export class SubscribeAgentDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(80) slug!: string;
  @IsString() @MinLength(1) @MaxLength(2000) description!: string;
  @IsUrl({ protocols: ['https'], require_protocol: true }) webhookUrl!: string;
  @IsString() @MinLength(40) @MaxLength(500) publicKey!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CapabilityDto)
  capabilities!: CapabilityDto[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  languages!: string[];
}

export class VerifyAgentDto {
  @IsString() challenge!: string;
  @IsString() signature!: string;
}

export class PatchAgentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) description?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CapabilityDto)
  capabilities?: CapabilityDto[];
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  languages?: string[];
}

export class HeartbeatDto {
  @IsIn(['ONLINE', 'BUSY', 'DEGRADED', 'OFFLINE']) status!:
    'ONLINE' | 'BUSY' | 'DEGRADED' | 'OFFLINE';
  @IsInt() @Min(0) @Max(100000) capacity!: number;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class RotateKeyDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  scopes?: string[];
}
