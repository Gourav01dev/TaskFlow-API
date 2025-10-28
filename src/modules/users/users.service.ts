import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,

    @Inject(CACHE_MANAGER)
    private cacheService: Cache, 
  ) { }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    const user = this.usersRepository.create({
      ...createUserDto,
      password: hashedPassword,
    });
    const savedUser = await this.usersRepository.save(user);

    await this.cacheService.del('users:all');

    return savedUser;
  }

  async findAll(): Promise<User[]> {
    const cacheKey = 'users:all';

    const cached = await this.cacheService.get<User[]>(cacheKey);
    if (cached) {
      console.log('Returning users from cache');
      return cached;
    }

    const users = await this.usersRepository.find();
    await this.cacheService.set(cacheKey, users, 60_000); 
    console.log('Saved users in cache');

    return users;
  }

  async findOne(id: string): Promise<User> {
    const cacheKey = `user:${id}`;

    const cached = await this.cacheService.get<User>(cacheKey);
    if (cached) {
      console.log(`Returning user ${id} from cache`);
      return cached;
    }

    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User with ID ${id} not found`);

    await this.cacheService.set(cacheKey, user, 60_000);
    console.log(`Cached user ${id}`);

    return user;
  }
  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    this.usersRepository.merge(user, updateUserDto);
    const updated = await this.usersRepository.save(user);

    await this.cacheService.set(`user:${id}`, updated);
    await this.cacheService.del('users:all');

    return updated;
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.usersRepository.remove(user);

    await this.cacheService.del(`user:${id}`);
    await this.cacheService.del('users:all');
  }
}
