function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`canalis-keeper: missing required env var ${name} (see .env.example)`);
  }
  return value;
}

export const config = {
  rpcUrl: requireEnv("RPC_URL"),
  executorAddress: requireEnv("EXECUTOR_ADDRESS") as `0x${string}`,
  keeperPrivateKey: requireEnv("KEEPER_PRIVATE_KEY") as `0x${string}`,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "60000"),
  // Block to start scanning FlowRegistered events from. Defaults to 0 (scan
  // the whole chain history); set to the executor's deployment block to
  // speed up startup once you know it.
  fromBlock: BigInt(process.env.FROM_BLOCK ?? "0"),
};
