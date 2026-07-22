import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { AccountDeletionService } from './account-deletion.service';

@Controller('account/deletion')
export class AccountDeletionController {
  constructor(private readonly service: AccountDeletionService) {}

  @Post()
  async requestDeletion(@Req() request: Request, @Body() body: unknown) {
    if (request.authenticatedUserId === undefined)
      throw new UnauthorizedException({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required',
      });
    return {
      data: await this.service.request(request.authenticatedUserId, body),
    };
  }
}
