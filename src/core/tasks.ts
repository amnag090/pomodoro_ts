import type { TaskItem } from '../types.js';

export function createTask(
  title: string,
  estimatedPomodoros = 1,
  id = crypto.randomUUID(),
  createdAt = new Date().toISOString(),
): TaskItem {
  const cleanTitle = title.trim();
  const safeEstimate = Math.min(20, Math.max(1, Math.round(estimatedPomodoros)));
  return {
    id,
    title: cleanTitle || 'Focused session',
    estimatedPomodoros: safeEstimate,
    completedPomodoros: 0,
    done: false,
    createdAt,
  };
}

export function addTask(
  tasks: readonly TaskItem[],
  activeTaskId: string | null,
  title: string,
  estimatedPomodoros = 1,
): { tasks: TaskItem[]; activeTaskId: string } {
  const task = createTask(title, estimatedPomodoros);
  const nextTasks = [task, ...tasks];
  return {
    tasks: nextTasks,
    activeTaskId: activeTaskId ?? task.id,
  };
}

export function toggleTaskDone(
  tasks: readonly TaskItem[],
  activeTaskId: string | null,
  taskId: string,
): { tasks: TaskItem[]; activeTaskId: string | null } {
  const nextTasks = tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
  let nextActive = activeTaskId;
  const toggled = nextTasks.find((t) => t.id === taskId);
  if (toggled?.done && activeTaskId === taskId) {
    nextActive = nextTasks.find((t) => !t.done)?.id ?? null;
  } else if (toggled && !toggled.done && activeTaskId === null) {
    nextActive = toggled.id;
  }
  return { tasks: nextTasks, activeTaskId: nextActive };
}

export function incrementTaskPomodoro(
  tasks: readonly TaskItem[],
  taskId: string | null,
): TaskItem[] {
  if (!taskId) return [...tasks];
  return tasks.map((t) =>
    t.id === taskId
      ? { ...t, completedPomodoros: t.completedPomodoros + 1 }
      : t,
  );
}

export function updateTask(
  tasks: readonly TaskItem[],
  taskId: string,
  patch: Partial<Pick<TaskItem, 'title' | 'estimatedPomodoros'>>,
): TaskItem[] {
  return tasks.map((t) => {
    if (t.id !== taskId) return t;
    const nextTitle = patch.title !== undefined ? patch.title.trim() || t.title : t.title;
    const nextEst =
      patch.estimatedPomodoros !== undefined
        ? Math.min(20, Math.max(1, Math.round(patch.estimatedPomodoros)))
        : t.estimatedPomodoros;
    return {
      ...t,
      title: nextTitle,
      estimatedPomodoros: nextEst,
    };
  });
}

export function moveTask(
  tasks: readonly TaskItem[],
  taskId: string,
  direction: 'up' | 'down',
): TaskItem[] {
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return [...tasks];
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= tasks.length) return [...tasks];

  const copy = [...tasks];
  const current = copy[idx];
  const target = copy[targetIdx];
  if (!current || !target) return copy;
  copy[idx] = target;
  copy[targetIdx] = current;
  return copy;
}

export function deleteTask(
  tasks: readonly TaskItem[],
  activeTaskId: string | null,
  taskId: string,
): { tasks: TaskItem[]; activeTaskId: string | null } {
  const nextTasks = tasks.filter((t) => t.id !== taskId);
  const nextActive =
    activeTaskId === taskId ? (nextTasks.find((t) => !t.done)?.id ?? null) : activeTaskId;
  return { tasks: nextTasks, activeTaskId: nextActive };
}

export function clearCompletedTasks(
  tasks: readonly TaskItem[],
  activeTaskId: string | null,
): { tasks: TaskItem[]; activeTaskId: string | null } {
  const nextTasks = tasks.filter((t) => !t.done);
  const stillHasActive = nextTasks.some((t) => t.id === activeTaskId);
  return {
    tasks: nextTasks,
    activeTaskId: stillHasActive ? activeTaskId : (nextTasks[0]?.id ?? null),
  };
}
