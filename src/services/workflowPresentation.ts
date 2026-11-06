import type { WorkflowStep } from '../types/domain';

/** A pending HTTP request is not evidence of model, search or patch activity. */
export function pendingRequestSteps(): WorkflowStep[] {
  return [
    { id: 'request', label: 'Request submitted', status: 'active',
      description: 'Waiting for the server response.' },
    { id: 'result', label: 'Read backend result', status: 'pending',
      description: 'Provider activity and workflow outcomes are not yet confirmed.' },
  ];
}
