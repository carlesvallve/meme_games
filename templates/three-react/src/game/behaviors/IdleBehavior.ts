import { Behavior, type BehaviorAgent, type BehaviorStatus } from './Behavior';

/** Simple behavior that just idles in place. */
export class IdleBehavior extends Behavior {
  update(agent: BehaviorAgent, dt: number): BehaviorStatus {
    agent.updateIdle(dt);
    return 'running';
  }
}
