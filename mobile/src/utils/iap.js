export async function safeIapCall(fn) {
  try {
    return await Promise.resolve(fn());
  } catch {
    return null;
  }
}
