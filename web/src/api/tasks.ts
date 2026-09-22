import { mutationHeaders, responseJSON } from './client';
import type { TaskRecord, TaskUpdate } from '@/types';

export async function updateTask(id: string, update: TaskUpdate): Promise<TaskRecord> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: mutationHeaders,
    body: JSON.stringify(update),
  });
  return responseJSON<TaskRecord>(response);
}
