import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception.getResponse();

    let message = 'Internal server error';
    let errors: any = undefined;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (exceptionResponse && typeof exceptionResponse === 'object') {
      if (Array.isArray((exceptionResponse as any).message)) {
        message = (exceptionResponse as any).message.join(', ');
      } else if ((exceptionResponse as any).message) {
        message = (exceptionResponse as any).message;
      } else if ((exceptionResponse as any).error) {
        message = (exceptionResponse as any).error;
      }
      if ((exceptionResponse as any).message && typeof (exceptionResponse as any).message !== 'string') {
        errors = (exceptionResponse as any).message;
      }
    } else if (exception.message) {
      message = exception.message;
    }


    if (status >= 500) {
      this.logger.error(
        `HTTP ${status} ${request.method} ${request.url} - ${message}`,
        exception.stack,
      );
    } else {
      this.logger.warn(`HTTP ${status} ${request.method} ${request.url} - ${message}`);
    }

    const body: any = {
      success: false,
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (errors) {
      body.errors = Array.isArray(errors) ? errors.slice(0, 10) : errors;
    }

    response.status(status).json(body);
  }
}
