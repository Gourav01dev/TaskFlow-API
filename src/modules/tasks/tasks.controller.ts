import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskFilterDto } from './dto/task-filter.dto';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { TaskStatus } from './enums/task-status.enum';

class JwtAuthGuard { }

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(JwtAuthGuard, RateLimitGuard)
@RateLimit({ limit: 100, windowMs: 60000 })
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly tasksService: TasksService) { }
  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  async create(@Body() createTaskDto: CreateTaskDto) {
    const task = await this.tasksService.create(createTaskDto);
    return {
      message: 'Task created successfully',
      data: task,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Find all tasks with optional filtering and pagination' })
  async findAll(@Query() filter: TaskFilterDto) {
    const result = await this.tasksService.findAll(filter);
    return {
      message: 'Tasks fetched successfully',
      ...result,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get task statistics' })
  async getStats() {

    return this.tasksService.getStats?.() ?? { message: 'Not implemented' };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Find a task by ID' })
  async findOne(@Param('id') id: string) {
    const task = await this.tasksService.findOne(id);
    return {
      message: 'Task fetched successfully',
      data: task,
    };
  }

  @Get('status/:status')
  @ApiOperation({ summary: 'Get all tasks by status' })
  async findByStatus(@Param('status') status: TaskStatus) {
    const tasks = await this.tasksService.findByStatus(status);
    return {
      message: `Tasks with status "${status}" fetched successfully`,
      data: tasks,
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  async update(@Param('id') id: string, @Body() updateTaskDto: UpdateTaskDto) {
    const updated = await this.tasksService.update(id, updateTaskDto);
    return {
      message: 'Task updated successfully',
      data: updated,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task' })
  async remove(@Param('id') id: string) {
    await this.tasksService.remove(id);
  }

  @Post('batch')
  @ApiOperation({ summary: 'Batch process multiple tasks (update/delete)' })
  async batchProcess(
    @Body() operations: { tasks: string[]; action: 'complete' | 'delete' },
  ) {
    const { tasks: taskIds, action } = operations;

    if (!taskIds?.length) {
      return {
        message: 'No task IDs provided',
        affected: 0,
      };
    }

    switch (action) {
      case 'complete': {
        const result = await this.tasksService.bulkUpdateStatus(
          taskIds,
          TaskStatus.COMPLETED,
        );
        return {
          message: 'Tasks marked as completed successfully',
          ...result,
        };
      }

      case 'delete': {
        const result = await this.tasksService.bulkDelete(taskIds);
        return {
          message: 'Tasks deleted successfully',
          ...result,
        };
      }

      default:
        throw new HttpException(
          `Unknown action: ${action}`,
          HttpStatus.BAD_REQUEST,
        );
    }
  }
}


