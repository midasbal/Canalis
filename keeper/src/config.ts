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
  // The CanalisAccount this keeper services. Flows are enumerated via
  // flowsOf(canalisAccount) — an eth_call, not a log scan — so this keeper
  // only ever needs to know about ONE account's flows. See README.md
  // "Flow discovery" for why (and what multi-account support would need).
  canalisAccount: requireEnv("CANALIS_ACCOUNT") as `0x${string}`,
  keeperPrivateKey: requireEnv("KEEPER_PRIVATE_KEY") as `0x${string}`,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "60000"),
};
