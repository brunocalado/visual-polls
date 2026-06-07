import {
  MODULE_ID,
  SETTING_ACTIVE_POLL,
  SETTING_SAVED_POLLS,
  SETTING_CREATOR_DEFAULTS,
  SETTING_SFX,
  QUERY_CAST_VOTE,
  POLL_STATUS,
  SHOW_VOTERS
} from "./constants.js";
import { PollState } from "./poll-data.js";
import { getActivePoll } from "./helpers.js";
import { SfxSettingsModel } from "./sfx.js";
import { PollCreatorApp } from "./apps/poll-creator.js";
import { PollDisplayApp } from "./apps/poll-display.js";
import { PollResultsApp } from "./apps/poll-results.js";
import { SfxSettingsApp } from "./apps/sfx-settings.js";

/* -------------------------------------------- */
/*  Singleton Application instances             */
/* -------------------------------------------- */

/** @type {PollCreatorApp|null} */
let creatorApp = null;
/** @type {PollDisplayApp|null} */
let displayApp = null;
/** @type {PollResultsApp|null} */
let resultsApp = null;

/* -------------------------------------------- */
/*  Registration (init hook)                    */
/* -------------------------------------------- */

/**
 * Register the world setting that stores the active poll, and all client-scoped
 * SFX preferences. The `onChange` on the poll setting fires on every connected
 * client whenever the value changes, propagating votes and status transitions in
 * real time. Called from `init`.
 * @returns {void}
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_ACTIVE_POLL, {
    scope: "world",
    config: false,
    type: PollState,
    default: { status: POLL_STATUS.IDLE },
    onChange: () => syncOpenApps()
  });

  game.settings.register(MODULE_ID, SETTING_SAVED_POLLS, {
    scope: "world",
    config: false,
    type: Object,
    default: []
  });

  game.settings.register(MODULE_ID, SETTING_CREATOR_DEFAULTS, {
    scope: "world",
    config: false,
    type: Object,
    default: { allowMultiple: false, resultsVisible: true, showVoters: SHOW_VOTERS.NONE }
  });

  game.settings.register(MODULE_ID, SETTING_SFX, {
    scope: "client",
    config: false,
    type: SfxSettingsModel,
    default: {},
  });

  game.settings.registerMenu(MODULE_ID, "sfxSettings", {
    name: "VISUAL_POLLS.SFX.MenuName",
    label: "VISUAL_POLLS.SFX.MenuLabel",
    hint: "VISUAL_POLLS.SFX.MenuHint",
    icon: "fa-solid fa-volume-high",
    type: SfxSettingsApp,
    restricted: false,
  });
}

/**
 * Register the promise-based query used by players to submit a vote to the
 * authoritative GM client. The handler only does real work on the client it is
 * invoked on (always the active GM, since that is who players target). Called
 * from `init`.
 * @returns {void}
 */
export function registerQueries() {
  CONFIG.queries[`${MODULE_ID}.${QUERY_CAST_VOTE}`] = async (data, context) => {
    // Trust the authenticated sender id from the query context; fall back to the
    // payload only if the runtime ever omits it.
    const voterId = context?.userId ?? data?.voterId;
    if (!voterId) return { ok: false, reason: "nouser" };
    return enqueueVote(voterId, data?.choices ?? []);
  };
}

/* -------------------------------------------- */
/*  Auto-close timer (GM-side only)             */
/* -------------------------------------------- */

/** @type {ReturnType<typeof setTimeout>|null} */
let autoCloseTimeout = null;

/**
 * Schedule an auto-close to fire at the given absolute timestamp. Only runs on
 * the GM client — players rely on the setting onChange for state sync.
 * Respects `resultsVisible`: if the poll was public the results are shared on
 * auto-close (same effect as the GM clicking "End Poll" in live-results mode);
 * if the poll was private the GM still decides after the timer fires.
 * @param {number} expiresAt  Unix timestamp (ms) when the poll should close.
 * @returns {void}
 */
function scheduleAutoClose(expiresAt) {
  clearAutoCloseTimer();
  const delay = expiresAt - Date.now();
  const close = () => {
    const poll = getActivePoll();
    endPoll(poll.resultsVisible);
  };
  if (delay <= 0) {
    close();
    return;
  }
  autoCloseTimeout = setTimeout(() => {
    autoCloseTimeout = null;
    close();
  }, delay);
}

/**
 * Cancel the pending auto-close timeout, if any.
 * @returns {void}
 */
function clearAutoCloseTimer() {
  if (autoCloseTimeout !== null) {
    clearTimeout(autoCloseTimeout);
    autoCloseTimeout = null;
  }
}

/* -------------------------------------------- */
/*  Vote application (authoritative writer)     */
/* -------------------------------------------- */

// Serialises concurrent vote writes on the GM client. Without this, two votes
// arriving close together could both read the pre-write state and the second
// `set` would clobber the first (lost update).
let voteChain = Promise.resolve();

/**
 * Queue a vote write so concurrent submissions are applied one at a time.
 * @param {string} voterId  Id of the voting user.
 * @param {number[]} choices  Chosen option indices.
 * @returns {Promise<{ok: boolean, reason?: string}>} Result of the write.
 */
function enqueueVote(voterId, choices) {
  const run = voteChain.then(() => applyVote(voterId, choices));
  // Keep the chain alive even if one write rejects.
  voteChain = run.catch(() => {});
  return run;
}

/**
 * Validate and persist a single vote into the active poll setting. Only ever
 * runs on the authoritative writer (the active GM).
 * @param {string} voterId  Id of the voting user.
 * @param {number[]} choices  Chosen option indices.
 * @returns {Promise<{ok: boolean, reason?: string}>} Result of the write.
 */
async function applyVote(voterId, choices) {
  const poll = getActivePoll();
  if (poll.status !== POLL_STATUS.OPEN) return { ok: false, reason: "closed" };
  if (poll.hasVoted(voterId)) return { ok: false, reason: "already" };

  const valid = (choices ?? []).filter(
    (i) => Number.isInteger(i) && i >= 0 && i < poll.options.length
  );
  if (valid.length === 0) return { ok: false, reason: "empty" };

  // A single-choice poll keeps only the first selection.
  const recorded = poll.allowMultiple ? [...new Set(valid)] : [valid[0]];

  const data = poll.toObject();
  data.votes = { ...data.votes, [voterId]: recorded };
  await game.settings.set(MODULE_ID, SETTING_ACTIVE_POLL, data);
  return { ok: true };
}

/**
 * Submit the current user's vote. The active GM writes directly; everyone else
 * sends a query to the active GM, who is the sole authoritative writer.
 * @param {number[]} choices  Chosen option indices.
 * @returns {Promise<void>}
 */
export async function submitVote(choices) {
  if (!choices?.length) return;

  const gm = game.users.activeGM;
  if (gm?.id === game.user.id) {
    const res = await enqueueVote(game.user.id, choices);
    if (!res.ok) notifyVoteFailure(res.reason);
    return;
  }

  if (!gm) {
    ui.notifications.warn(game.i18n.localize("VISUAL_POLLS.Notify.NoGM"));
    return;
  }

  try {
    const res = await gm.query(
      `${MODULE_ID}.${QUERY_CAST_VOTE}`,
      { voterId: game.user.id, choices },
      { timeout: 10000 }
    );
    if (!res?.ok) notifyVoteFailure(res?.reason);
  } catch (err) {
    console.error(`${MODULE_ID} | Vote submission failed`, err);
    ui.notifications.error(game.i18n.localize("VISUAL_POLLS.Notify.VoteError"));
  }
}

/**
 * Surface a localized warning explaining why a vote was rejected.
 * @param {string} [reason]  Machine reason returned by the writer.
 * @returns {void}
 */
function notifyVoteFailure(reason) {
  const key =
    reason === "already"
      ? "VISUAL_POLLS.Notify.AlreadyVoted"
      : reason === "closed"
        ? "VISUAL_POLLS.Notify.PollClosed"
        : "VISUAL_POLLS.Notify.VoteError";
  ui.notifications.warn(game.i18n.localize(key));
}

/* -------------------------------------------- */
/*  GM poll lifecycle                           */
/* -------------------------------------------- */

/**
 * Create and immediately open a poll to all players.
 * @param {object} config  Poll configuration.
 * @param {string} config.question  The poll question.
 * @param {string[]} config.options  Option labels (>= 2 non-empty expected).
 * @param {boolean} config.allowMultiple  Whether multiple options may be chosen.
 * @param {boolean} config.resultsVisible  Whether players see live results.
 * @param {string} config.showVoters  Voter visibility level: "none", "gm", or "all".
 * @returns {Promise<void>}
 */
export async function startPoll({ question, options, allowMultiple, resultsVisible, showVoters, targetUserIds, duration }) {
  const createdAt = Date.now();
  const expiresAt = (duration > 0) ? createdAt + duration * 1000 : 0;
  const poll = {
    id: foundry.utils.randomID(),
    question: question.trim(),
    options: options.map(({ text, image }) => ({ text: text.trim(), image })),
    allowMultiple: Boolean(allowMultiple),
    resultsVisible: Boolean(resultsVisible),
    showVoters: showVoters,
    // Empty array means all players are targeted.
    targetUserIds: Array.isArray(targetUserIds) ? [...targetUserIds] : [],
    status: POLL_STATUS.OPEN,
    votes: {},
    createdAt,
    expiresAt
  };
  await game.settings.set(MODULE_ID, SETTING_ACTIVE_POLL, poll);
  if (expiresAt > 0) scheduleAutoClose(expiresAt);
}

/**
 * End the active poll. When `shareResults` is true the final tally is revealed
 * to players; when false the poll closes silently and players see no results.
 * @param {boolean} [shareResults=false]  Whether to reveal the tally to players.
 * @returns {Promise<void>}
 */
export async function endPoll(shareResults = false) {
  clearAutoCloseTimer();
  const data = getActivePoll().toObject();
  if (data.status !== POLL_STATUS.OPEN) return;
  data.status = POLL_STATUS.CLOSED;
  data.resultsShared = shareResults;
  await game.settings.set(MODULE_ID, SETTING_ACTIVE_POLL, data);
}

/**
 * Clear the active poll, dismissing every player's display.
 * @returns {Promise<void>}
 */
export async function clearPoll() {
  clearAutoCloseTimer();
  await game.settings.set(MODULE_ID, SETTING_ACTIVE_POLL, {
    status: POLL_STATUS.IDLE,
    id: "",
    question: "",
    options: [],
    votes: {}
  });
}

/* -------------------------------------------- */
/*  Application orchestration                   */
/* -------------------------------------------- */

/**
 * Open the poll creation form (GM only entry point).
 * @returns {void}
 */
export function openCreator() {
  creatorApp ??= new PollCreatorApp();
  creatorApp.render({ force: true });
}

/**
 * Close the creation form, if open. Called after a poll is started.
 * @returns {void}
 */
export function closeCreator() {
  creatorApp?.close();
  creatorApp = null;
}

/**
 * Clear the active poll and open a fresh creation form (GM "New Poll" action).
 * @returns {Promise<void>}
 */
export async function newPoll() {
  await clearPoll();
  openCreator();
}

/**
 * Clear the active poll and reopen the creator pre-filled with the same
 * question, options, and settings — letting the GM tweak before re-launching.
 * `targetUserIds` is intentionally reset to "all" since the prior audience
 * context is no longer meaningful after a poll ends.
 * @returns {Promise<void>}
 */
export async function repeatPoll() {
  const poll = getActivePoll();
  const draft = {
    question: poll.question,
    options: poll.options.map(o => ({ text: o.text, image: o.image })),
    allowMultiple: poll.allowMultiple,
    resultsVisible: poll.resultsVisible,
    showVoters: poll.showVoters,
    targetUserIds: []
  };
  await clearPoll();
  creatorApp = new PollCreatorApp();
  creatorApp.draft = draft;
  creatorApp.render({ force: true });
}

/**
 * Initialize this client on the `ready` hook. GMs clear any lingering poll so
 * they must create a new one after a reload. Players reconcile normally so they
 * still see an in-progress poll they may not have voted on yet.
 * @returns {Promise<void>}
 */
export async function initClient() {
  if (game.user.isGM) {
    const poll = getActivePoll();
    if (poll.isActive) {
      // clearPoll triggers onChange → syncOpenApps on every client.
      await clearPoll();
      return;
    }
  }
  syncOpenApps();
}

/**
 * Reconcile open Applications with the current poll state for this client.
 * GMs see the live results monitor; players see the voting display. Triggered on
 * the setting's `onChange` (real-time) and once on `ready` (reload / late join).
 * @returns {void}
 */
export function syncOpenApps() {
  const poll = getActivePoll();
  // Explicit status check instead of poll.isActive getter to be resilient against
  // DataModel getter issues in certain V14 builds.
  const status = poll?.status ?? POLL_STATUS.IDLE;
  const active = status === POLL_STATUS.OPEN || status === POLL_STATUS.CLOSED;

  if (game.user.isGM) {
    if (active) showResultsApp();
    else hideResultsApp();
    return;
  }

  if (active) {
    const ids = poll.targetUserIds ?? [];
    const isTargeted = ids.length === 0 || ids.includes(game.user.id);
    if (isTargeted) showDisplayApp();
    else hideDisplayApp();
  } else {
    hideDisplayApp();
  }
}

/**
 * Render (or re-render) the player voting display.
 * @returns {void}
 */
function showDisplayApp() {
  displayApp ??= new PollDisplayApp();
  displayApp.render({ force: true });
}

/**
 * Close the player voting display.
 * @returns {void}
 */
function hideDisplayApp() {
  displayApp?.close();
  displayApp = null;
}

/**
 * Render (or re-render) the GM results monitor.
 * @returns {void}
 */
function showResultsApp() {
  resultsApp ??= new PollResultsApp();
  resultsApp.render({ force: true });
}

/**
 * Close the GM results monitor.
 * @returns {void}
 */
function hideResultsApp() {
  resultsApp?.close();
  resultsApp = null;
}
