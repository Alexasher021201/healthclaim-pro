import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '@healthclaim/shared';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const httpContext = context.switchToHttp?.();
    const response = httpContext?.getResponse?.();
    const statusCode = response?.statusCode || 200;

    return next.handle().pipe(
      map((data) => ({
        statusCode,
        success: true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
