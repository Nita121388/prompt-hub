const chains = new Map<string, Promise<void>>();

/**
 * 串行执行同一 key 的异步任务（避免 read-modify-write 并发导致丢数据）。
 * - key 建议用文件绝对路径（fsPath）
 */
export async function enqueueByKey<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = () => task();
  const next = prev.then(run, run);

  // 保持链不断，同时吞掉异常，避免 Map 中遗留“拒绝态 Promise”
  const settle = next.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, settle);

  try {
    return await next;
  } finally {
    // 若没有后续任务接上来，则清理 key，避免 Map 无限增长
    if (chains.get(key) === settle) {
      chains.delete(key);
    }
  }
}
