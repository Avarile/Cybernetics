import { Injectable } from '@nestjs/common';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { PasswordService } from '../auth/password.service';
import type { UserRow } from '../../infrastructure/database/schema/identity.schema';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import { UserRepository } from './user.repository';

/** User as exposed by the API — never includes the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  role: UserRow['role'];
  displayName: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UserRepository,
    private readonly passwords: PasswordService,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(row: UserRow): PublicUser {
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      displayName: row.displayName ?? null,
      createdAt: row.createdAt,
      lastLoginAt: row.lastLoginAt ?? null,
    };
  }

  async create(dto: CreateUserDto): Promise<PublicUser> {
    const email = dto.email.toLowerCase();
    if (await this.repo.findByEmail(email)) {
      throw this.errors.create(ErrorCode.USER_EMAIL_TAKEN);
    }
    const passwordHash = await this.passwords.hash(dto.password);
    const row = await this.repo.create({
      email,
      passwordHash,
      role: dto.role ?? 'user',
      displayName: dto.displayName,
    });
    return this.toPublic(row);
  }

  async findById(id: string): Promise<PublicUser> {
    const row = await this.repo.findActiveById(id);
    if (!row) throw this.errors.create(ErrorCode.USER_NOT_FOUND);
    return this.toPublic(row);
  }

  async list(page: number, limit: number) {
    const { rows, total } = await this.repo.list(page, limit);
    return { data: rows.map((r) => this.toPublic(r)), total, page, limit };
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    await this.findById(id); // 404 if missing
    const patch: Record<string, unknown> = {};
    if (dto.role) patch.role = dto.role;
    if (dto.displayName !== undefined) patch.displayName = dto.displayName;
    if (dto.password)
      patch.passwordHash = await this.passwords.hash(dto.password);
    const row = await this.repo.update(id, patch);
    if (!row) throw this.errors.create(ErrorCode.USER_NOT_FOUND);
    return this.toPublic(row);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.repo.softDelete(id);
  }
}
