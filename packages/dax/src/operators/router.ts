import type { Operator } from './base';
import type { PlannedTask } from '../planner/task-graph';

export class OperatorRouter {
  private operators: Map<string, Operator> = new Map();

  register(operator: Operator) {
    this.operators.set(operator.type, operator);
  }

  getOperator(type: string): Operator | undefined {
    return this.operators.get(type);
  }

  async route(task: PlannedTask): Promise<Operator> {
    const operator = this.operators.get(task.operator_type);
    if (!operator) {
      throw new Error(`No operator found for type: ${task.operator_type}`);
    }
    return operator;
  }
}

// Singleton router instance
export const defaultRouter = new OperatorRouter();
