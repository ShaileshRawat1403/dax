export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'awaiting_approval';

export interface PlannedTask {
  id: string;
  name: string;
  description: string;
  operator_type: string;
  status: TaskStatus;
  dependencies: string[]; // Task IDs that must complete before this one
  context: Record<string, any>;
  result?: any;
  error?: Error;
}

export interface TaskGraph {
  id: string;
  intent_id?: string;
  tasks: Map<string, PlannedTask>;
  status: TaskStatus;
}

export function createTaskGraph(id: string): TaskGraph {
  return {
    id,
    tasks: new Map(),
    status: 'pending',
  };
}

export function addTask(graph: TaskGraph, task: Omit<PlannedTask, 'status'>): TaskGraph {
  graph.tasks.set(task.id, {
    ...task,
    status: 'pending',
  });
  return graph;
}

export function getRunnableTasks(graph: TaskGraph): PlannedTask[] {
  const runnable: PlannedTask[] = [];
  for (const task of graph.tasks.values()) {
    if (task.status !== 'pending') continue;
    
    // Check if all dependencies are completed
    const depsMet = task.dependencies.every(depId => {
      const dep = graph.tasks.get(depId);
      return dep && dep.status === 'completed';
    });

    if (depsMet) {
      runnable.push(task);
    }
  }
  return runnable;
}
