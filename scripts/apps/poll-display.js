import { MODULE_ID, TEMPLATES, POLL_STATUS, SHOW_VOTERS } from "../constants.js";
import { getActivePoll } from "../helpers.js";
import { submitVote } from "../poll-controller.js";
import { playHover, playSelectedOption, playConfirmVote, playFinalResults } from "../sfx.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Player-facing voting template. Auto-opened for every player when a poll starts
 * and re-rendered live as votes arrive. After voting (or once the poll closes)
 * the selection controls lock and the final state remains on screen.
 * @extends {foundry.applications.api.ApplicationV2}
 */
export class PollDisplayApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "visual-polls-display",
    classes: [MODULE_ID, "vp-app"],
    position: { width: 440, height: "auto" },
    window: {
      title: "VISUAL_POLLS.Display.Title",
      icon: "fa-solid fa-square-poll-vertical"
    },
    actions: {
      select: this.prototype._onSelect,
      confirm: this.prototype._onConfirm
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.display }
  };

  /**
   * Pending pre-vote selection (option indices). Reset when the poll changes.
   * @type {Set<number>}
   */
  selection = new Set();

  /** Id of the poll the current selection belongs to. @type {string} */
  _pollId = "";

  /** Cached multi-select flag for the live select handler. @type {boolean} */
  _allowMultiple = false;

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

    // A different poll means any stale selection must be discarded.
    // _wasClosed is pre-set to avoid playing the sound when joining a poll
    // that is already in the closed state.
    if (this._pollId !== poll.id) {
      this.selection = new Set();
      this._pollId = poll.id;
      // Pre-set to avoid playing the fanfare when joining a poll already closed+revealed.
      this._wasClosed = poll.status === POLL_STATUS.CLOSED && poll.resultsShared;
    }
    this._allowMultiple = poll.allowMultiple;

    const voted = poll.hasVoted(game.user.id);
    const myChoice = poll.votes[game.user.id] ?? [];
    const closed = poll.status === POLL_STATUS.CLOSED;
    // When open: follow the creator's live-results preference.
    // When closed: only show results if the GM explicitly published them.
    const showResults = closed ? poll.resultsShared : poll.resultsVisible;
    const showFinalBanner = closed && poll.resultsShared;

    const showVotersInUI = poll.showVoters === SHOW_VOTERS.ALL && showResults;
    const optionRows = poll.results.map((row) => ({
      ...row,
      selected: voted ? myChoice.includes(row.index) : this.selection.has(row.index),
      hasVoters: showVotersInUI && row.hasVoters,
      voterNames: showVotersInUI ? row.voters.join(", ") : ""
    }));

    const open = poll.status === POLL_STATUS.OPEN;
    let initialPercent = null;
    if (poll.hasTimer && open) {
      const total = poll.expiresAt - poll.createdAt;
      const remaining = poll.expiresAt - Date.now();
      if (total > 0) initialPercent = Math.max(0, Math.min(100, (remaining / total) * 100)).toFixed(1);
    }

    return {
      question: poll.question,
      options: optionRows,
      allowMultiple: poll.allowMultiple,
      showResults,
      showFinalBanner,
      voted,
      closed,
      open,
      disabled: voted || closed,
      totalVoters: poll.totalVoters,
      hasTimer: poll.hasTimer,
      expiresAt: poll.expiresAt,
      createdAt: poll.createdAt,
      initialPercent
    };
  }

  /** @inheritDoc */
  _onRender(context, options) {
    // Reflect the current selection size on the confirm button after each render.
    const confirm = this.element.querySelector(".vp-confirm");
    if (confirm) confirm.disabled = this.selection.size === 0;

    // Attach hover sounds only to interactive (non-disabled) option cards.
    for (const card of this.element.querySelectorAll(".vp-card:not([disabled])")) {
      card.addEventListener("mouseenter", () => playHover());
    }

    // Fire the fanfare only when the GM publishes results (open→closed+shared transition).
    if (context.showFinalBanner && !this._wasClosed) {
      this._wasClosed = true;
      playFinalResults(getActivePoll(), game.user.id);
    }
    if (!context.showFinalBanner) this._wasClosed = false;

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
    const width = maxLen > 180 ? 720 : maxLen > 100 ? 600 : maxLen > 50 ? 520 : 440;
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
   * Toggle an option selection without a full re-render (snappy feedback).
   * Single-choice polls keep only the latest pick. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @param {HTMLElement} target  The card carrying `data-index`.
   * @returns {void}
   */
  _onSelect(event, target) {
    const index = Number(target.dataset.index);
    if (this._allowMultiple) {
      this.selection.has(index) ? this.selection.delete(index) : this.selection.add(index);
    } else {
      this.selection.clear();
      this.selection.add(index);
    }
    playSelectedOption();

    for (const card of this.element.querySelectorAll(".vp-card")) {
      card.classList.toggle("vp-selected", this.selection.has(Number(card.dataset.index)));
    }
    const confirm = this.element.querySelector(".vp-confirm");
    if (confirm) confirm.disabled = this.selection.size === 0;
  }

  /**
   * Submit the pending selection. The authoritative write propagates back via the
   * setting's `onChange`, which re-renders this app in its voted state. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onConfirm(event) {
    if (this.selection.size === 0) return;
    playConfirmVote();
    const choices = [...this.selection];
    this.selection = new Set();
    await submitVote(choices);
  }
}
