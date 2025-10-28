import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';


const rateLimitStore = new Map<string, { count: number; expiresAt: number }>();

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const ip = this.anonymizeIp(request.ip);


    const rateLimitOptions =
      this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, context.getHandler()) ||
      this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, context.getClass()) ||
      { limit: 100, windowMs: 60_000 }; 

    return this.handleRateLimit(ip, rateLimitOptions);
  }

  private handleRateLimit(ip: string, { limit, windowMs }: RateLimitOptions): boolean {
    const now = Date.now();
    const record = rateLimitStore.get(ip);

    if (!record || record.expiresAt < now) {
      rateLimitStore.set(ip, { count: 1, expiresAt: now + windowMs });
      return true;
    }

    if (record.count >= limit) {
      const retryAfter = Math.ceil((record.expiresAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Rate limit of ${limit} requests per ${windowMs / 1000}s exceeded.`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    record.count++;
    rateLimitStore.set(ip, record);
    return true;
  }

  private anonymizeIp(ip: string): string {
    return ip.replace(/\d+$/, 'x');
  }
}
