import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { z, ZodError, type ZodType } from 'zod';

/**
 * Validates a payload against a Zod schema. Mirrors the app's env-validation
 * style: on failure, responds 400 with the list of issues. Generic over the
 * schema so the output type is inferred (handles coercion / defaults).
 */
@Injectable()
export class ZodValidationPipe<S extends ZodType> implements PipeTransform<
  unknown,
  z.infer<S>
> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    try {
      return this.schema.parse(value) as z.infer<S>;
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.') || '(root)',
            message: issue.message,
          })),
        });
      }
      throw error;
    }
  }
}
