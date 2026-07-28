import { ActionType, TriggerType } from "./flows";
import { emptyAction, emptyCondition, newSplitRecipientRow, type ComposerDraft } from "./composer";

/**
 * One-click starting points for the composer (Stage 4). Each produces a
 * real, structurally valid draft — recipient addresses are left blank
 * (there's no honest way to guess someone's payout addresses), everything
 * else is a sensible default the user can tweak before deploying.
 */
export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  build: () => ComposerDraft;
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: "paycheck-splitter",
    name: "Paycheck splitter",
    description: "When USDC arrives, split it 70/30 between two recipients.",
    build: () => {
      const action = emptyAction(ActionType.Split);
      action.splitTotal = "100";
      const r1 = newSplitRecipientRow();
      r1.bps = "7000";
      const r2 = newSplitRecipientRow();
      r2.bps = "3000";
      action.splitRecipients = [r1, r2];

      return {
        trigger: { kind: TriggerType.OnReceive, scheduleMode: "now", scheduleAt: "", intervalSeconds: "", thresholdAmount: "" },
        conditions: [],
        actions: [action],
      };
    },
  },
  {
    id: "scheduled-payout",
    name: "Scheduled payout",
    description: "Every hour, forward a fixed amount to one recipient.",
    build: () => {
      const action = emptyAction(ActionType.Forward);
      action.forwardAmount = "10";

      return {
        trigger: { kind: TriggerType.OnSchedule, scheduleMode: "now", scheduleAt: "", intervalSeconds: "3600", thresholdAmount: "" },
        conditions: [],
        actions: [action],
      };
    },
  },
  {
    id: "savings-sweep",
    name: "Savings sweep",
    description: "Once a day, sweep everything above a threshold to a savings address.",
    build: () => {
      const action = emptyAction(ActionType.Sweep);
      action.sweepThreshold = "50";

      return {
        trigger: { kind: TriggerType.OnSchedule, scheduleMode: "now", scheduleAt: "", intervalSeconds: "86400", thresholdAmount: "" },
        conditions: [],
        actions: [action],
      };
    },
  },
  {
    id: "recurring-dca",
    name: "Recurring DCA",
    description: "Every few minutes, if EUR/USD is below a threshold, swap USDC into EURC.",
    build: () => {
      const condition = emptyCondition("oraclePrice");
      condition.oracleFeedKey = "EURUSD";
      condition.oracleDirection = "below";
      condition.oracleThreshold = "1.15";
      condition.oracleMaxStalenessSeconds = "300";

      const action = emptyAction(ActionType.Swap);
      action.swapTokenIn = "USDC";
      action.swapAmountIn = "5";

      return {
        trigger: { kind: TriggerType.OnSchedule, scheduleMode: "now", scheduleAt: "", intervalSeconds: "300", thresholdAmount: "" },
        conditions: [condition],
        actions: [action],
      };
    },
  },
  {
    id: "treasury-rebalance",
    name: "Treasury rebalance",
    description: "If EUR/USD is above a threshold, swap some USDC to EURC and split the rest 50/50.",
    build: () => {
      const condition = emptyCondition("oraclePrice");
      condition.oracleFeedKey = "EURUSD";
      condition.oracleDirection = "above";
      condition.oracleThreshold = "1.10";
      condition.oracleMaxStalenessSeconds = "300";

      const swapAction = emptyAction(ActionType.Swap);
      swapAction.swapTokenIn = "USDC";
      swapAction.swapAmountIn = "10";

      const splitAction = emptyAction(ActionType.Split);
      splitAction.splitTotal = "50";
      const r1 = newSplitRecipientRow();
      r1.bps = "5000";
      const r2 = newSplitRecipientRow();
      r2.bps = "5000";
      splitAction.splitRecipients = [r1, r2];

      return {
        trigger: { kind: TriggerType.Manual, scheduleMode: "now", scheduleAt: "", intervalSeconds: "", thresholdAmount: "" },
        conditions: [condition],
        actions: [swapAction, splitAction],
      };
    },
  },
];
