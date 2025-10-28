import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const SENSITIVE_KEYS = ['password', 'token', 'access_token', 'refresh_token'];

function redact(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  try {
    const clone = Array.isArray(obj) ? [...obj] : { ...obj };
    for (const key of Object.keys(clone)) {
      if (SENSITIVE_KEYS.includes(key)) {
        clone[key] = '[REDACTED]';
      } else if (typeof clone[key] === 'object') {
        clone[key] = redact(clone[key]);
      }
    }
    return clone;
  } catch {
    return '[UNREDACTED]';
  }
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const url = req.originalUrl || req.url;
    const start = Date.now();
    const userId = req.user?.id ?? null;

    this.logger.log(`Request START ${method} ${url} ${userId ? `[user:${userId}]` : ''} body=${JSON.stringify(redact(req.body || {}))}`);

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          const ms = Date.now() - start;
          this.logger.log(
            `Request END ${method} ${url} ${userId ? `[user:${userId}]` : ''} ${ms}ms response=${JSON.stringify(redact(responseBody || {}))}`,
          );
        },
        error: (err) => {
          const ms = Date.now() - start;
          this.logger.error(
            `Request ERROR ${method} ${url} ${userId ? `[user:${userId}]` : ''} ${ms}ms - ${err.message}`,
          );
        },
      }),
    );
  }
}
