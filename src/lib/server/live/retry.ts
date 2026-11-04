import type { RetryChoice } from '$lib/liveView';
import type { PublishOutcome } from '$lib/publishOutcome';
import { publish, resumeFromPing, resumeFromVerify } from '$lib/server/publish/publish';
import { loadRetryPlan, type LiveDeps } from './state';

export const retryLiveAction = async (
  deps: LiveDeps,
  choice: RetryChoice
): Promise<PublishOutcome> => {
  const plan = await loadRetryPlan(deps);

  if (plan === null) {
    return {
      ok: false,
      failedStep: 'refused',
      reason: 'Nothing failed, so nothing needs a retry.'
    };
  }

  if (!plan.choices.includes(choice)) {
    return {
      ok: false,
      failedStep: 'refused',
      reason: `The ${choice} step does not fit this failure. The choices are: ${plan.choices.join(', ')}.`
    };
  }

  if (choice === 'publish' || plan.entry === undefined) {
    return publish(deps, { reason: plan.pingReason });
  }

  return choice === 'verify'
    ? resumeFromVerify(deps, plan.entry)
    : resumeFromPing(deps, plan.entry);
};
