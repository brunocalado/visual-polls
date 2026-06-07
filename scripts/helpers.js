import { MODULE_ID, SETTING_ACTIVE_POLL } from "./constants.js";

/**
 * Read the current active-poll state. Returns a {@link PollState} instance
 * (the setting is registered with the model as its type), so callers get the
 * computed getters (`results`, `totalVoters`, `hasVoted`).
 *
 * Used across the controller and every Application, hence its place here.
 * @returns {import("./poll-data.js").PollState} The live poll state.
 */
export function getActivePoll() {
  return game.settings.get(MODULE_ID, SETTING_ACTIVE_POLL);
}
