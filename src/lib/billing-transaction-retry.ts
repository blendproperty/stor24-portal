// P2034 transactions are rolled back by PostgreSQL before retry.
export async function retryBillingSerialization<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run(); }
    catch (error) {
      if (attempt >= 4 || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}
