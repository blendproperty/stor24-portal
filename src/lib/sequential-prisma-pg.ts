import { PrismaPg } from "@prisma/adapter-pg";

// A PostgreSQL transaction owns one connection, even when Prisma requests relations concurrently.
export class SequentialPrismaPg extends PrismaPg {
  override async connect() {
    const adapter = await super.connect();
    const startTransaction = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async isolationLevel => {
      const transaction = await startTransaction(isolationLevel);
      let pending = Promise.resolve();
      function sequential<Args extends unknown[], Value>(operation: (...args: Args) => Promise<Value>) {
        return (...args: Args) => {
          const result = pending.then(() => operation(...args));
          pending = result.then(() => undefined, () => undefined);
          return result;
        };
      }
      transaction.queryRaw = sequential(transaction.queryRaw.bind(transaction));
      transaction.executeRaw = sequential(transaction.executeRaw.bind(transaction));
      transaction.commit = sequential(transaction.commit.bind(transaction));
      transaction.rollback = sequential(transaction.rollback.bind(transaction));
      return transaction;
    };
    return adapter;
  }
}
