import { AppError } from '../../../core/errors';

export class ForgeGenerationError extends AppError {
  readonly code = 'FORGE_GENERATION_ERROR';
  readonly status = 500;
  constructor(message: string) { super(message); }
}
