import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async set(key: string, value: any, ttlSeconds?: number) {
    this.logger.log(`Setting cache: ${key}`);
    await this.cacheManager.set(key, value, ttlSeconds);
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.cacheManager.get<T>(key);
    this.logger.log(data ? `Cache HIT: ${key}` : `Cache MISS: ${key}`);
    return data ?? null;
  }

  async delete(key: string) {
    this.logger.log(`Deleting cache: ${key}`);
    await this.cacheManager.del(key);
  }

  async reset() {
    this.logger.warn(`Clearing entire cache`);
    await this.cacheManager.clear();
  }
}
