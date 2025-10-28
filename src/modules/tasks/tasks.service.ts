import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Task } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TaskStatus } from './enums/task-status.enum';
import { TaskFilterDto } from './dto/task-filter.dto';
import { PaginatedResponse } from '../../types/pagination.interface';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    private readonly dataSource: DataSource,
    @InjectQueue('task-processing')
    private readonly taskQueue: Queue,
    @Inject(CACHE_MANAGER)
    private readonly cacheService: Cache,
  ) { }

  private async invalidateTaskCache(): Promise<void> {
    const keys = ['tasks:all', 'tasks:stats'];
    for (const key of keys) {
      await this.cacheService.del(key);
    }
    this.logger.debug('Cache invalidated for tasks');
  }

  private getCacheKey(filter: TaskFilterDto): string {
    return `tasks:${JSON.stringify(filter)}`;
  }


  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Task);
      const task = repo.create(createTaskDto);
      const saved = await repo.save(task);

      try {
        await this.taskQueue.add(
          'task-status-update',
          { taskId: saved.id, status: saved.status },
          { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
        );
      } catch (err) {
        this.logger.error(`Failed to enqueue job for ${saved.id}: ${err}`);
      }

      return saved;
    });

    await this.invalidateTaskCache();
    return result;
  }

  async findAll(filter: TaskFilterDto): Promise<PaginatedResponse<Task>> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 10;
    const skip = (page - 1) * limit;
    const cacheKey = this.getCacheKey(filter);

    const cached = await this.cacheService.get<PaginatedResponse<Task>>(cacheKey);
    if (cached) {
      this.logger.debug(`Returning tasks from Redis cache for key: ${cacheKey}`);
      return cached;
    }

    const qb = this.tasksRepository.createQueryBuilder('task').leftJoinAndSelect('task.user', 'user');

    if (filter.status) qb.andWhere('task.status = :status', { status: filter.status });
    if (filter.priority) qb.andWhere('task.priority = :priority', { priority: filter.priority });
    if (filter.q)
      qb.andWhere('(task.title ILIKE :q OR task.description ILIKE :q)', { q: `%${filter.q}%` });

    const orderField = ['title', 'createdAt', 'dueDate', 'priority', 'status'].includes(
      filter.sortBy ?? '',
    )
      ? `task.${filter.sortBy}`
      : 'task.createdAt';

    qb.orderBy(orderField, filter.sortOrder === 'ASC' ? 'ASC' : 'DESC')
      .skip(skip)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    const response = {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    await this.cacheService.set(cacheKey, response);
    this.logger.debug(` Cached tasks in Redis under key: ${cacheKey}`);

    return response;
  }

  async getStats() {
    const cacheKey = 'tasks:stats';
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      this.logger.debug('Returning stats from Redis cache');
      return cached;
    }

    const qb = this.tasksRepository.createQueryBuilder('task')
      .select('COUNT(task.id)', 'total')
      .addSelect("SUM(CASE WHEN task.status = 'COMPLETED' THEN 1 ELSE 0 END)", 'completed')
      .addSelect("SUM(CASE WHEN task.status = 'IN_PROGRESS' THEN 1 ELSE 0 END)", 'inProgress')
      .addSelect("SUM(CASE WHEN task.status = 'PENDING' THEN 1 ELSE 0 END)", 'pending')
      .addSelect("SUM(CASE WHEN task.priority = 'HIGH' THEN 1 ELSE 0 END)", 'highPriority');

    const raw = await qb.getRawOne();
    const stats = {
      total: parseInt(raw.total || 0, 10),
      completed: parseInt(raw.completed || 0, 10),
      inProgress: parseInt(raw.inProgress || 0, 10),
      pending: parseInt(raw.pending || 0, 10),
      highPriority: parseInt(raw.highPriority || 0, 10),
    };

    await this.cacheService.set(cacheKey, stats);
    this.logger.debug('Cached stats in Redis');
    return stats;
  }


  async findOne(id: string): Promise<Task> {
    const cacheKey = `task:${id}`;
    const cached = await this.cacheService.get<Task>(cacheKey);
    if (cached) {
      this.logger.debug(`Returning task ${id} from Redis cache`);
      return cached;
    }

    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!task) throw new NotFoundException(`Task with ID ${id} not found`);

    await this.cacheService.set(cacheKey, task);
    this.logger.debug(` Cached single task ${id}`);
    return task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Task);
      const task = await repo.findOne({ where: { id } });
      if (!task) throw new NotFoundException(`Task with ID ${id} not found`);

      const originalStatus = task.status;
      repo.merge(task, updateTaskDto);
      const saved = await repo.save(task);

      if (originalStatus !== saved.status) {
        try {
          await this.taskQueue.add(
            'task-status-update',
            { taskId: saved.id, status: saved.status },
            { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
          );
        } catch (err) {
          this.logger.error(`Failed to enqueue status-update for ${saved.id}: ${err}`);
        }
      }

      await this.invalidateTaskCache();
      await this.cacheService.del(`task:${id}`);
      this.logger.debug(`Cache invalidated after updating task ${id}`);

      return saved;
    });
  }


  async remove(id: string) {
    const result = await this.tasksRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    await this.invalidateTaskCache();
    await this.cacheService.del(`task:${id}`);
    this.logger.debug(`🗑️ Cache invalidated after deleting task ${id}`);
    return result;
  }


  async bulkUpdateStatus(ids: string[], status: TaskStatus): Promise<{ affected: number }> {
    if (ids.length === 0) return { affected: 0 };

    const result = await this.tasksRepository
      .createQueryBuilder()
      .update(Task)
      .set({ status })
      .where('id IN (:...ids)', { ids })
      .execute();

    for (const id of ids) {
      await this.cacheService.del(`task:${id}`);
      try {
        await this.taskQueue.add(
          'task-status-update',
          { taskId: id, status },
          { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
        );
      } catch (err) {
        this.logger.error(`Failed to enqueue job for ${id}: ${err}`);
      }
    }

    await this.invalidateTaskCache();
    return { affected: result.affected ?? 0 };
  }

  
  async bulkDelete(ids: string[]): Promise<{ affected: number }> {
    if (ids.length === 0) return { affected: 0 };

    const result = await this.tasksRepository
      .createQueryBuilder()
      .delete()
      .from(Task)
      .where('id IN (:...ids)', { ids })
      .execute();

    for (const id of ids) await this.cacheService.del(`task:${id}`);
    await this.invalidateTaskCache();

    return { affected: result.affected ?? 0 };
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    return await this.tasksRepository.find({ where: { status }, order: { createdAt: 'DESC' }, });
  }


  async updateStatus(id: string, status: TaskStatus): Promise<Task> {
    const task = await this.tasksRepository.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`Task with ID ${id} not found`);

    task.status = status;
    const updated = await this.tasksRepository.save(task);

    await this.invalidateTaskCache();
    await this.cacheService.del(`task:${id}`);
    this.logger.debug(` Cache invalidated after updating status for ${id}`);

    return updated;
  }
}
