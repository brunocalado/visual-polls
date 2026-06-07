import { MODULE_ID, TEMPLATES, POLL_STATUS, SHOW_VOTERS } from "../constants.js";
import { getActivePoll } from "../helpers.js";
import { endPoll, newPoll, repeatPoll } from "../poll-controller.js";
import { playFinalResults } from "../sfx.js";


const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only live results monitor. Always shows the running tally (even when player
 * results are hidden) and carries the controls to end or replace the poll.
 * @extends {foundry.applications.api.ApplicationV2}
 */
export class PollResultsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "visual-polls-results",
    classes: [MODULE_ID, "vp-app"],
    position: { width: 460, height: "auto" },
    window: {
      title: "VISUAL_POLLS.Results.Title",
      icon: "fa-solid fa-chart-simple"
    },
    actions: {
      endHidden: this.prototype._onEndHidden,
      endPublished: this.prototype._onEndPublished,
      newPoll: this.prototype._onNewPoll,
      repeatPoll: this.prototype._onRepeatPoll
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.results }
  };

  /**
   * Tracks whether the last render showed the poll as closed, so the
   * final-results sound fires only once on the open→closed transition.
   * @type {boolean}
   */
  _wasClosed = false;

  /** Active setInterval id for the countdown bar, or null when idle. @type {number|null} */
  _timerInterval = null;

  /** @inheritDoc */
  async _prepareContext(options) {
    const poll = getActivePoll();
    // GM sees voter names for both "gm" and "all" settings.
    const showVotersForGM = poll.showVoters !== SHOW_VOTERS.NONE;
    const open = poll.status === POLL_STATUS.OPEN;
    let initialPercent = null;
    if (poll.hasTimer && open) {
      const total = poll.expiresAt - poll.createdAt;
      const remaining = poll.expiresAt - Date.now();
      if (total > 0) initialPercent = Math.max(0, Math.min(100, (remaining / total) * 100)).toFixed(1);
    }

    return {
      question: poll.question,
      options: poll.results.map((row) => ({
        ...row,
        voterNames: row.voters.join(", "),
        hasVoters: showVotersForGM && row.hasVoters
      })),
      totalVoters: poll.totalVoters,
      allowMultiple: poll.allowMultiple,
      resultsVisible: poll.resultsVisible,
      open,
      closed: poll.status === POLL_STATUS.CLOSED,
      hasTimer: poll.hasTimer,
      expiresAt: poll.expiresAt,
      createdAt: poll.createdAt,
      initialPercent
    };
  }

  /**
   * Play the final-results fanfare on the GM's client when the poll closes, and
   * sync the countdown bar interval and window width. Called from `_onRender`.
   * @param {object} context
   * @param {object} options
   * @returns {void}
   */
  _onRender(context, options) {
    if (context.closed && !this._wasClosed) {
      this._wasClosed = true;
      playFinalResults(getActivePoll(), game.user.id);
    }
    if (!context.closed) this._wasClosed = false;

    this._syncTimer(context);
    this._syncWidth(context);
  }

  /**
   * Widen the window when question or option text is long so fewer line-wraps are
   * needed, reducing the total height of the poll template.
   * Called from `_onRender`.
   * @param {object} context  The prepared context from `_prepareContext`.
   * @returns {void}
   */
  _syncWidth(context) {
    const maxLen = Math.max(
      context.question.length,
      ...context.options.map(o => (o.text ?? "").length)
    );
    const width = maxLen > 180 ? 740 : maxLen > 100 ? 620 : maxLen > 50 ? 540 : 460;
    if (this.position.width !== width) this.setPosition({ width });
  }

  /**
   * Clear and conditionally restart the countdown bar interval. Called after every
   * render to ensure the interval points at the fresh DOM element and reflects the
   * correct elapsed time. Stops automatically when the poll closes or time runs out.
   * Called from `_onRender`.
   * @param {object} context  The prepared context from `_prepareContext`.
   * @returns {void}
   */
  _syncTimer(context) {
    clearInterval(this._timerInterval);
    this._timerInterval = null;
    if (!context.hasTimer || !context.open) return;

    const bar = this.element?.querySelector(".vp-timer-fill");
    if (!bar) return;

    const { expiresAt, createdAt } = context;
    const total = expiresAt - createdAt;

    this._timerInterval = setInterval(() => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        bar.style.setProperty("--vp-timer-fill", "0%");
        clearInterval(this._timerInterval);
        this._timerInterval = null;
        return;
      }
      bar.style.setProperty("--vp-timer-fill", `${Math.max(0, (remaining / total) * 100).toFixed(1)}%`);
    }, 500);
  }

  /** @inheritDoc */
  _onClose(options) {
    clearInterval(this._timerInterval);
    this._timerInterval = null;
  }

  /**
   * End the poll without revealing results to players. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onEndHidden(event) {
    await endPoll(false);
  }

  /**
   * End the poll and publish the final tally to players. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onEndPublished(event) {
    await endPoll(true);
  }

  /**
   * Dismiss the current poll and open a fresh creation form. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onNewPoll(event) {
    await newPoll();
  }

  /**
   * Reopen the creator pre-filled with this poll's settings so the GM can
   * re-run the same poll with optional edits. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onRepeatPoll(event) {
    await repeatPoll();
  }
}
