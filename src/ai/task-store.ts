import type { TaskRecord, GenerateRequest, ProviderId, TaskStatus } from "./types";

export interface TaskPatch {
  status?: TaskStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  fallbackFrom?: ProviderId;
  outputFiles?: string[];
}

export function createTaskRecord(request: GenerateRequest): TaskRecord {
  const now = Date.now();
  return {
    id: `task-${now}-${Math.random().toString(36).slice(2, 8)}`,
    provider: request.provider,
    mode: request.mode,
    prompt: request.prompt,
    status: "pending",
    createdAt: now,
    outputs: [],
    outputFiles: [],
    imageSourceKind: request.imageSource?.kind,
  };
}

export function patchTaskRecord(task: TaskRecord, patch: TaskPatch): TaskRecord {
  return {
    ...task,
    ...patch,
    outputFiles: patch.outputFiles ?? task.outputFiles,
  };
}
