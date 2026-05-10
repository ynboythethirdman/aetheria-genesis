/**
 * Mirror — Worker Pool
 *
 * Generic concurrent task executor with configurable concurrency.
 * Used across all Mirror processes for parallel model downloads,
 * title generation, and uploads.
 */

/**
 * Run tasks concurrently with a maximum concurrency limit.
 *
 * @param {Array} items - Items to process
 * @param {Function} worker - async function(item, index) => result
 * @param {number} concurrency - Max parallel workers (default 10)
 * @param {Function} [onProgress] - optional callback(completed, total, result)
 * @returns {Promise<Array>} Results in the same order as items
 */
async function runPool(items, worker, concurrency = 10, onProgress = null) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        results[idx] = { error: err.message };
      }
      completed++;
      if (onProgress) onProgress(completed, items.length, results[idx]);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(runNext());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Run tasks in batches — all items in a batch run concurrently,
 * then the next batch starts. Useful for rate-limited APIs.
 *
 * @param {Array} items
 * @param {Function} worker - async function(item, index)
 * @param {number} batchSize - Items per batch
 * @param {number} delayMs - Delay between batches (ms)
 * @returns {Promise<Array>}
 */
async function runBatched(items, worker, batchSize = 10, delayMs = 500) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, batchIdx) => {
        const globalIdx = i + batchIdx;
        return worker(item, globalIdx).catch((err) => ({ error: err.message }));
      })
    );
    results.push(...batchResults);

    if (i + batchSize < items.length && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}

module.exports = { runPool, runBatched };
