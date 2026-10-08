export type CleaningTaskTiming = {
  status: string;
  arrival_at: string | null;
};

export const isMissedCleaningTask = (task: CleaningTaskTiming, now: Date) =>
  task.status !== "verified" && task.arrival_at !== null && Date.parse(task.arrival_at) <= now.getTime();
