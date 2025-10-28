
import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TasksService } from '../../modules/tasks/tasks.service';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

@Injectable()
@Processor('task-processing')
export class TaskProcessorService extends WorkerHost {
  private readonly logger = new Logger(TaskProcessorService.name);

  constructor(private readonly tasksService: TasksService) {
    super();
  }

  async process(job: Job): Promise<any> {
    this.logger.debug(`Processing job ${job.id} (${job.name})`);

    try {
      switch (job.name) {
        case 'task-status-update':
          return await this.handleStatusUpdate(job);
        case 'overdue-tasks-notification':
          return await this.handleOverdueTasks(job);
        default:
          this.logger.warn(`Unknown job type: ${job.name}`);
          return { success: false, error: 'Unknown job type' };
      }
    } catch (error) {
      this.logger.error(
        `Error processing job ${job.id}: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }
  private async handleStatusUpdate(job: Job) {
    const { taskId, status } = job.data;

    if (!taskId || !status) {
      this.logger.warn('Missing taskId or status in task-status-update job');
      return { success: false, error: 'Missing required data' };
    }

    if (!Object.values(TaskStatus).includes(status)) {
      this.logger.warn(`Invalid status value received: ${status}`);
      return { success: false, error: 'Invalid status value' };
    }

    try {
      const task = await this.tasksService.updateStatus(taskId, status);
      return { success: true, taskId: task.id, newStatus: task.status };
    } catch (err) {
      this.logger.error(`Failed to update status for ${taskId}: ${err}`);
      throw err;
    }
  }
  private async handleOverdueTasks(job: Job) {
    const { taskId } = job.data;

    if (!taskId) {
      this.logger.warn('Missing taskId for overdue-tasks-notification job');
      return { success: false, error: 'Missing taskId' };
    }
    try {
      const task = await this.tasksService.findOne(taskId);
      this.logger.debug(`Overdue notification for task ${taskId} (status=${task.status})`);
      return { success: true, taskId };
    } catch (err) {
      this.logger.error(`Error processing overdue task ${taskId}: ${err}`);
      throw err;
    }
  }
}
