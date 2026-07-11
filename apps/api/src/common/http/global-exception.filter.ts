import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { getCorrelationId, getRequestId } from './request-context';

interface ErrorDetails {
  readonly code?: string;
  readonly details?: unknown;
  readonly message?: string | string[];
}

function isErrorDetails(value: unknown): value is ErrorDetails {
  return typeof value === 'object' && value !== null;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const details = isErrorDetails(payload) ? payload : undefined;
    const isUnexpected = status >= 500;
    const message = this.resolveMessage(
      details?.message,
      payload,
      isUnexpected,
    );

    if (isUnexpected) {
      this.logger.error({
        correlationId: getCorrelationId(request),
        errorCode: details?.code ?? `HTTP_${status}`,
        errorType:
          exception instanceof Error
            ? exception.constructor.name
            : 'UnknownError',
        module: 'http',
        operation: request.originalUrl,
        requestId: getRequestId(request),
        service: 'atlas-api',
      });
    }

    response.status(status).json({
      error: {
        code: details?.code ?? `HTTP_${status}`,
        message,
        ...(details?.details !== undefined ? { details: details.details } : {}),
        requestId: getRequestId(request),
      },
    });
  }

  private resolveMessage(
    message: string | string[] | undefined,
    payload: string | object | undefined,
    isUnexpected: boolean,
  ): string {
    if (isUnexpected) {
      return 'Beklenmeyen bir hata oluştu.';
    }

    if (Array.isArray(message)) {
      return message.join(', ');
    }

    if (typeof message === 'string') {
      return message;
    }

    return typeof payload === 'string' ? payload : 'İstek işlenemedi.';
  }
}
