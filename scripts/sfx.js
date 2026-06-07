import { MODULE_ID, SETTING_SFX, SFX_DEFAULT_PATHS } from "./constants.js";

/**
 * DataModel holding SFX preferences for a single client. Registered once under
 * `SETTING_SFX` with `scope: "client"` so every user has independent control
 * over their own audio experience.
 */
export class SfxSettingsModel extends foundry.abstract.DataModel {
  /** @inheritDoc */
  static defineSchema() {
    const { NumberField, BooleanField, StringField } = foundry.data.fields;
    return {
      volume: new NumberField({ required: true, initial: 0.8, min: 0, max: 1 }),
      hoverEnabled: new BooleanField({ required: true, initial: true }),
      selectedEnabled: new BooleanField({ required: true, initial: true }),
      confirmEnabled: new BooleanField({ required: true, initial: true }),
      finalWinEnabled: new BooleanField({ required: true, initial: true }),
      finalTieEnabled: new BooleanField({ required: true, initial: true }),
      finalFailureEnabled: new BooleanField({ required: true, initial: true }),
      hoverPath: new StringField({ required: true, initial: SFX_DEFAULT_PATHS.hover }),
      selectedPath: new StringField({ required: true, initial: SFX_DEFAULT_PATHS.selectedOption }),
      confirmPath: new StringField({ required: true, initial: SFX_DEFAULT_PATHS.confirmVote }),
      finalWinPath: new StringField({ required: true, initial: SFX_DEFAULT_PATHS.finalResultsWin }),
      finalTiePath: new StringField({ required: true, initial: SFX_DEFAULT_PATHS.finalResultsTie }),
      finalFailurePath: new StringField({ required: true, initial: SFX_DEFAULT_PATHS.finalResultsFailure }),
    };
  }
}

/**
 * Read the current SFX configuration from the client setting.
 * @returns {SfxSettingsModel}
 */
function getSfx() {
  return game.settings.get(MODULE_ID, SETTING_SFX);
}

/**
 * Dispatch an audio event through Foundry's AudioHelper if the sound is enabled.
 * @param {boolean} enabled  Whether this sound slot is active.
 * @param {string} src  Resolved file path.
 * @param {number} volume  Master volume (0–1).
 * @returns {void}
 */
function playSfx(enabled, src, volume) {
  if (!enabled) return;
  foundry.audio.AudioHelper.play({ src, volume, loop: false });
}

/**
 * Play the hover sound when a player moves over a poll option card.
 * @returns {void}
 */
export function playHover() {
  const s = getSfx();
  playSfx(s.hoverEnabled, s.hoverPath, s.volume);
}

/**
 * Play the selection sound when a player clicks a poll option card.
 * @returns {void}
 */
export function playSelectedOption() {
  const s = getSfx();
  playSfx(s.selectedEnabled, s.selectedPath, s.volume);
}

/**
 * Play the confirm sound when a player submits their vote.
 * @returns {void}
 */
export function playConfirmVote() {
  const s = getSfx();
  playSfx(s.confirmEnabled, s.confirmPath, s.volume);
}

/**
 * Determine the poll outcome from the perspective of a specific user.
 * Returns null if the user did not vote, so no sound is played for spectators.
 * @param {import("./poll-data.js").PollState} poll  The ended poll.
 * @param {string} userId  The user whose vote is evaluated.
 * @returns {"win"|"tie"|"failure"|null}
 */
function determinePollOutcome(poll, userId) {
  const userVotes = poll.votes[userId];
  if (!Array.isArray(userVotes) || userVotes.length === 0) return null;

  const results = poll.results;
  const maxCount = Math.max(...results.map(r => r.count));

  // No votes cast at all → tie (edge case: poll closed with zero participation)
  if (maxCount === 0) return "tie";

  const winners = results.filter(r => r.count === maxCount);

  // Multiple options tied for the highest count → unresolved tie
  if (winners.length > 1) return "tie";

  return userVotes.includes(winners[0].index) ? "win" : "failure";
}

/**
 * Play the appropriate final-results sound based on the poll outcome for the
 * given user. No sound is played if the user did not cast a vote.
 * Called on every client the moment results are revealed.
 * @param {import("./poll-data.js").PollState} poll  The ended poll.
 * @param {string} userId  The current user's id.
 * @returns {void}
 */
export function playFinalResults(poll, userId) {
  const outcome = determinePollOutcome(poll, userId);
  if (outcome === null) return;
  const s = getSfx();
  if (outcome === "win") playSfx(s.finalWinEnabled, s.finalWinPath, s.volume);
  else if (outcome === "tie") playSfx(s.finalTieEnabled, s.finalTiePath, s.volume);
  else playSfx(s.finalFailureEnabled, s.finalFailurePath, s.volume);
}
