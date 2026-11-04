export const PUBLISH_IN_FLIGHT = 'publish in flight';

type LockResult<TValue> = { refused: false; value: TValue } | { refused: true; message: string };

/*
	The server-side bound behind R18 and KTD9. A second tab cannot start a publish
	while one runs: it receives a refusal, not a place in a queue, so a late press
	of Go live never runs after the show has moved on.
*/
export const createPublishLock = () => {
  let isBusy = false;

  return {
    isBusy: (): boolean => isBusy,

    run: async <TValue>(task: () => Promise<TValue>): Promise<LockResult<TValue>> => {
      if (isBusy) {
        return { refused: true, message: PUBLISH_IN_FLIGHT };
      }

      isBusy = true;

      try {
        return { refused: false, value: await task() };
      } finally {
        isBusy = false;
      }
    }
  };
};
