/**
 * Module-wide shared constants. Dependency-free leaf: imports nothing from the
 * rest of the module so it can be imported anywhere without circular-import risk.
 */

/** Single source of truth for the module id (matches the `id` in module.json). */
export const MODULE_ID = "visual-polls";

/** World setting key holding the single active poll state. */
export const SETTING_ACTIVE_POLL = "activePoll";

/** World setting key holding saved poll templates (array, no player targeting). */
export const SETTING_SAVED_POLLS = "savedPolls";

/** World setting key holding the GM's last-used creator toggle defaults. */
export const SETTING_CREATOR_DEFAULTS = "creatorDefaults";

/**
 * Query name token for casting a vote. Combined with MODULE_ID at the two call
 * sites (registration + invocation) as `${MODULE_ID}.${QUERY_CAST_VOTE}`.
 */
export const QUERY_CAST_VOTE = "castVote";

/** Lifecycle states of the active poll. */
export const POLL_STATUS = Object.freeze({
  IDLE: "idle",
  OPEN: "open",
  CLOSED: "closed"
});

/** Default 1×1 image assigned to a new poll option. */
export const DEFAULT_OPTION_IMAGE = "icons/magic/symbols/question-stone-yellow.webp";

/** World setting key holding the SFX configuration (volume, toggles, paths). */
export const SETTING_SFX = "sfx";

/** Default audio file paths bundled with the module. */
export const SFX_DEFAULT_PATHS = Object.freeze({
  hover: `modules/${MODULE_ID}/assets/sfx/hover.ogg`,
  selectedOption: `modules/${MODULE_ID}/assets/sfx/selected-option.ogg`,
  confirmVote: `modules/${MODULE_ID}/assets/sfx/confirm-vote.ogg`,
  finalResultsWin: `modules/${MODULE_ID}/assets/sfx/final-results-win.ogg`,
  finalResultsTie: `modules/${MODULE_ID}/assets/sfx/final-results-tie.ogg`,
  finalResultsFailure: `modules/${MODULE_ID}/assets/sfx/final-results-failure.ogg`,
});

/**
 * Voter-visibility levels for the `showVoters` poll setting.
 * - `NONE`: voter names are never shown.
 * - `GM`:   only the GM sees who voted for each option.
 * - `ALL`:  every targeted player also sees voter names.
 */
export const SHOW_VOTERS = Object.freeze({
  NONE: "none",
  GM: "gm",
  ALL: "all"
});

/** Handlebars template paths, resolved from the module root. */
export const TEMPLATES = Object.freeze({
  creator: `modules/${MODULE_ID}/templates/poll-creator.hbs`,
  display: `modules/${MODULE_ID}/templates/poll-display.hbs`,
  results: `modules/${MODULE_ID}/templates/poll-results.hbs`,
  pollTimer: `modules/${MODULE_ID}/templates/poll-timer.hbs`,
  sfxSettings: `modules/${MODULE_ID}/templates/sfx-settings.hbs`,
});
