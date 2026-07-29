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
  // Pyth's real IPyth contract on Arc testnet — see CLAUDE.md / Deploy.s.sol.
  oracleAddress: requireEnv("ORACLE_ADDRESS") as `0x${string}`,
  // Pyth's PRODUCTION Hermes price-update API (free, no key) — NOT
  // hermes-beta.pyth.network. Confirmed on-chain: Arc testnet's deployed
  // Pyth contract verifies against the real production Wormhole guardian
  // set and rejects hermes-beta-signed updates with "InvalidWormholeVaa"
  // (also means production feed ids, not the beta catalog's ids — see
  // web/src/lib/oracleFeeds.ts / docs/canalis-spec.md section 7.3 #2).
  hermesUrl: process.env.HERMES_URL ?? "https://hermes.pyth.network",
  // Telegram flow-run notifications — entirely optional. Both unset =
  // notifications silently disabled, keeper runs normally (see notify.ts).
  // The bot token stays server-side here; never sent to/read by the
  // frontend or committed (see .env.example's placeholder values).
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
};
