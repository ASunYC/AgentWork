import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticatedRequest, HumanAuthGuard } from './auth';
import { LoginDto, RegisterDto } from './identity.dto';
import { IdentityService } from './identity.service';

@Controller('v1')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('identity/register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.identity.register(dto.email, dto.password);
    this.setCookie(response, result.token);
    return result.user;
  }

  @Post('identity/login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.identity.login(dto.email, dto.password);
    this.setCookie(response, result.token);
    return result.user;
  }

  @Get('me')
  @UseGuards(HumanAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.identity.me(request.user!.id);
  }

  @Post('identity/logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('aw_session', { path: '/' });
    return { success: true };
  }

  private setCookie(response: Response, token: string) {
    response.cookie('aw_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
}
