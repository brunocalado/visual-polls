import { MODULE_ID, TEMPLATES, DEFAULT_OPTION_IMAGE, SHOW_VOTERS, SETTING_SAVED_POLLS, SETTING_CREATOR_DEFAULTS } from "../constants.js";
import { startPoll, closeCreator } from "../poll-controller.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Minimum number of options a poll must offer. */
const MIN_OPTIONS = 2;

/** Maps each SHOW_VOTERS state to its localization key for the creator label. */
const SHOW_VOTERS_LABEL_KEYS = {
  [SHOW_VOTERS.NONE]: "VISUAL_POLLS.Creator.ShowVoters.None",
  [SHOW_VOTERS.GM]:   "VISUAL_POLLS.Creator.ShowVoters.GMOnly",
  [SHOW_VOTERS.ALL]:  "VISUAL_POLLS.Creator.ShowVoters.All"
};

/**
 * GM-only form to compose and launch a poll. Holds its own draft state so option
 * rows can be added/removed without losing already-typed values across re-renders.
 * @extends {foundry.applications.api.ApplicationV2}
 */
export class PollCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "visual-polls-creator",
    classes: [MODULE_ID, "vp-app"],
    position: { width: 660, height: "auto" },
    window: {
      title: "VISUAL_POLLS.Creator.Title",
      icon: "fa-solid fa-square-poll-vertical"
    },
    actions: {
      addOption: this.prototype._onAddOption,
      removeOption: this.prototype._onRemoveOption,
      pickImage: this.prototype._onPickImage,
      toggleTargetAll: this.prototype._onToggleTargetAll,
      toggleTargetUser: this.prototype._onToggleTargetUser,
      cycleShowVoters: this.prototype._onCycleShowVoters,
      start: this.prototype._onStart,
      savePoll: this.prototype._onSavePoll,
      loadPoll: this.prototype._onLoadPoll,
      openTimerDialog: this.prototype._onOpenTimerDialog
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.creator }
  };

  /**
   * Working copy of the form, persisted across re-renders.
   * @type {{question: string, options: Array<{text: string, image: string}>, allowMultiple: boolean, resultsVisible: boolean, showVoters: string, targetUserIds: string[]}}
   */
  draft;

  /** @inheritDoc */
  async _prepareContext(options) {
    if (!this.draft) {
      const saved = game.settings.get(MODULE_ID, SETTING_CREATOR_DEFAULTS);
      this.draft = {
        question: "",
        options: [
          { text: "", image: DEFAULT_OPTION_IMAGE },
          { text: "", image: DEFAULT_OPTION_IMAGE }
        ],
        allowMultiple: saved.allowMultiple ?? false,
        resultsVisible: saved.resultsVisible ?? true,
        showVoters: saved.showVoters ?? SHOW_VOTERS.NONE,
        // Empty array = send to all players.
        targetUserIds: [],
        duration: 0
      };
    }
    // Ensure duration exists when a draft is set externally (e.g. repeatPoll).
    this.draft.duration ??= 0;

    const targetAll = this.draft.targetUserIds.length === 0;
    const connectedPlayers = [...game.users]
      .filter(u => !u.isGM && u.active)
      .map(u => ({
        id: u.id,
        name: u.name,
        // Color instance in V14; fall back to plain string for safety.
        color: u.color?.css ?? String(u.color),
        isSelected: this.draft.targetUserIds.includes(u.id)
      }));

    return {
      question: this.draft.question,
      options: this.draft.options,
      allowMultiple: this.draft.allowMultiple,
      allowMultipleLabel: game.i18n.localize(
        this.draft.allowMultiple
          ? "VISUAL_POLLS.Creator.AllowMultiple.On"
          : "VISUAL_POLLS.Creator.AllowMultiple.Off"
      ),
      resultsVisible: this.draft.resultsVisible,
      resultsVisibleLabel: game.i18n.localize(
        this.draft.resultsVisible
          ? "VISUAL_POLLS.Creator.ResultsVisible.On"
          : "VISUAL_POLLS.Creator.ResultsVisible.Off"
      ),
      showVoters: this.draft.showVoters,
      showVotersLabel: game.i18n.localize(
        SHOW_VOTERS_LABEL_KEYS[this.draft.showVoters] ?? SHOW_VOTERS_LABEL_KEYS[SHOW_VOTERS.NONE]
      ),
      canRemove: this.draft.options.length > MIN_OPTIONS,
      targetAll,
      connectedPlayers,
      hasConnectedPlayers: connectedPlayers.length > 0,
      timerActive: this.draft.duration > 0,
      timerSeconds: this.draft.duration
    };
  }

  /**
   * Pull the current DOM values into the draft before any re-render. Called from
   * `_onRender` is not enough — add/remove must capture in-flight edits first.
   * @returns {void}
   */
  _syncDraftFromDom() {
    const root = this.element;
    if (!root) return;
    this.draft.question = root.querySelector('[data-field="question"]')?.value ?? "";
    this.draft.allowMultiple =
      root.querySelector('[data-field="allowMultiple"]')?.checked ?? false;
    this.draft.resultsVisible =
      root.querySelector('[data-field="resultsVisible"]')?.checked ?? false;
    this.draft.showVoters =
      root.querySelector('[data-field="showVoters"]')?.dataset.value ?? SHOW_VOTERS.NONE;
    this.draft.options = [...root.querySelectorAll("[data-option]")].map((input, i) => ({
      text: input.value,
      image: this.draft.options[i]?.image ?? DEFAULT_OPTION_IMAGE
    }));
  }

  /**
   * Persist the three toggle defaults so the next creator session starts with
   * the GM's last-used values.
   * @returns {Promise<void>}
   */
  async _saveDefaults() {
    await game.settings.set(MODULE_ID, SETTING_CREATOR_DEFAULTS, {
      allowMultiple: this.draft.allowMultiple,
      resultsVisible: this.draft.resultsVisible,
      showVoters: this.draft.showVoters
    });
  }

  /**
   * Attach change listeners to the two boolean checkboxes so toggling them
   * triggers a re-render and updates their dynamic label text. Called after
   * every render because the DOM is replaced each time.
   * @param {object} context  The prepared context (unused here).
   * @param {object} options  Render options (unused here).
   * @returns {void}
   */
  _onRender(context, options) {
    const root = this.element;
    for (const field of ["allowMultiple", "resultsVisible"]) {
      root.querySelector(`[data-field="${field}"]`)?.addEventListener("change", async () => {
        this._syncDraftFromDom();
        await this._saveDefaults();
        await this.render();
      });
    }
  }

  /**
   * Add an empty option row. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onAddOption(event) {
    this._syncDraftFromDom();
    this.draft.options.push({ text: "", image: DEFAULT_OPTION_IMAGE });
    await this.render();
  }

  /**
   * Remove an option row, keeping at least the minimum. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @param {HTMLElement} target  The element carrying `data-index`.
   * @returns {Promise<void>}
   */
  async _onRemoveOption(event, target) {
    this._syncDraftFromDom();
    const index = Number(target.dataset.index);
    if (this.draft.options.length > MIN_OPTIONS) {
      this.draft.options.splice(index, 1);
      await this.render();
    }
  }

  /**
   * Open a FilePicker so the GM can choose a 1×1 image for a specific option.
   * Action handler for the image thumbnail button on each option row.
   * @param {PointerEvent} event  The originating click.
   * @param {HTMLElement} target  The element carrying `data-index`.
   * @returns {void}
   */
  _onPickImage(event, target) {
    this._syncDraftFromDom();
    const index = Number(target.dataset.index);
    const current = this.draft.options[index]?.image ?? DEFAULT_OPTION_IMAGE;
    const FilePickerClass =
      foundry.applications.apps.FilePicker.implementation ??
      foundry.applications.apps.FilePicker;
    new FilePickerClass({
      type: "image",
      current,
      callback: async (path) => {
        this.draft.options[index].image = path;
        await this.render();
      }
    }).render({ force: true });
  }

  /**
   * Cycle voter-visibility through none → gm → all → none. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onCycleShowVoters(event) {
    this._syncDraftFromDom();
    const states = Object.values(SHOW_VOTERS);
    const idx = states.indexOf(this.draft.showVoters);
    this.draft.showVoters = states[(idx + 1) % states.length];
    await this._saveDefaults();
    await this.render();
  }

  /**
   * Switch targeting back to all players. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onToggleTargetAll(event) {
    this._syncDraftFromDom();
    this.draft.targetUserIds = [];
    await this.render();
  }

  /**
   * Toggle an individual player in or out of the targeted set. Clicking when
   * "All" is active starts a specific selection with only that player. Removing
   * the last player reverts to "All" (empty array). Action handler.
   * @param {PointerEvent} event  The originating click.
   * @param {HTMLElement} target  The element carrying `data-user-id`.
   * @returns {Promise<void>}
   */
  async _onToggleTargetUser(event, target) {
    this._syncDraftFromDom();
    const userId = target.dataset.userId;
    const current = this.draft.targetUserIds;

    if (current.length === 0) {
      // "All" was active — start a specific selection with only this user.
      this.draft.targetUserIds = [userId];
    } else if (current.includes(userId)) {
      // Deselect; empty result reverts to "All".
      this.draft.targetUserIds = current.filter(id => id !== userId);
    } else {
      this.draft.targetUserIds = [...current, userId];
    }
    await this.render();
  }

  /**
   * Save the current draft as a reusable template. Prompts the GM for a name.
   * `targetUserIds` is intentionally excluded — player selection is never saved.
   * Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onSavePoll(event) {
    this._syncDraftFromDom();
    if (!this.draft.question.trim()) {
      ui.notifications.warn(game.i18n.localize("VISUAL_POLLS.Notify.NeedQuestion"));
      return;
    }

    const name = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("VISUAL_POLLS.Saved.SaveTitle"), icon: "fa-solid fa-floppy-disk" },
      content: `<input type="text" name="tpl-name" autofocus style="width:100%" maxlength="80" placeholder="${game.i18n.localize("VISUAL_POLLS.Saved.NamePlaceholder")}" />`,
      ok: {
        label: game.i18n.localize("VISUAL_POLLS.Saved.Save"),
        icon: "fa-solid fa-floppy-disk",
        callback: (event, button) => button.form.elements["tpl-name"].value.trim()
      }
    });
    if (!name) return;

    const template = {
      id: foundry.utils.randomID(),
      name,
      question: this.draft.question.trim(),
      options: this.draft.options.map(o => ({ text: o.text, image: o.image })),
      allowMultiple: this.draft.allowMultiple,
      resultsVisible: this.draft.resultsVisible,
      showVoters: this.draft.showVoters
    };

    const saved = game.settings.get(MODULE_ID, SETTING_SAVED_POLLS) ?? [];
    await game.settings.set(MODULE_ID, SETTING_SAVED_POLLS, [...saved, template]);
    ui.notifications.info(game.i18n.format("VISUAL_POLLS.Saved.Saved", { name }));
  }

  /**
   * Open a dialog so the GM can load or delete a saved template. Loading
   * overwrites the current draft after a confirmation when draft has content.
   * `targetUserIds` is never restored from a template. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onLoadPoll(event) {
    this._syncDraftFromDom();
    const saved = game.settings.get(MODULE_ID, SETTING_SAVED_POLLS) ?? [];

    if (!saved.length) {
      ui.notifications.info(game.i18n.localize("VISUAL_POLLS.Saved.Empty"));
      return;
    }

    const options = saved.map((t, i) => {
      const preview = t.question.length > 40 ? `${t.question.slice(0, 40)}…` : t.question;
      return `<option value="${i}">${foundry.utils.escapeHTML(t.name)} — ${foundry.utils.escapeHTML(preview)}</option>`;
    }).join("");

    let result;
    try {
      result = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("VISUAL_POLLS.Saved.LoadTitle"), icon: "fa-solid fa-folder-open" },
        content: `<select name="tpl-idx" style="width:100%">${options}</select>`,
        modal: true,
        buttons: [
          {
            action: "load",
            label: game.i18n.localize("VISUAL_POLLS.Saved.Load"),
            icon: "fa-solid fa-upload",
            default: true,
            callback: (event, button) => ({ do: "load", index: Number(button.form.elements["tpl-idx"].value) })
          },
          {
            action: "delete",
            label: game.i18n.localize("VISUAL_POLLS.Saved.Delete"),
            icon: "fa-solid fa-trash",
            callback: (event, button) => ({ do: "delete", index: Number(button.form.elements["tpl-idx"].value) })
          },
          { action: "cancel", label: game.i18n.localize("VISUAL_POLLS.Saved.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
        ]
      });
    } catch {
      return;
    }

    if (!result?.do) return;

    if (result.do === "delete") {
      const updated = [...saved];
      const [deleted] = updated.splice(result.index, 1);
      await game.settings.set(MODULE_ID, SETTING_SAVED_POLLS, updated);
      ui.notifications.info(game.i18n.format("VISUAL_POLLS.Saved.Deleted", { name: deleted.name }));
      return;
    }

    // Warn before overwriting a non-empty draft.
    const draftHasContent = this.draft.question.trim() || this.draft.options.some(o => o.text.trim());
    if (draftHasContent) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("VISUAL_POLLS.Saved.OverwriteTitle") },
        content: `<p>${game.i18n.localize("VISUAL_POLLS.Saved.OverwriteWarning")}</p>`,
        yes: { label: game.i18n.localize("VISUAL_POLLS.Saved.Overwrite"), icon: "fa-solid fa-check" },
        no: { label: game.i18n.localize("VISUAL_POLLS.Saved.Cancel"), icon: "fa-solid fa-xmark" }
      });
      if (!confirmed) return;
    }

    const template = saved[result.index];
    this.draft.question = template.question;
    this.draft.options = template.options.map(o => ({ ...o }));
    this.draft.allowMultiple = template.allowMultiple;
    this.draft.resultsVisible = template.resultsVisible;
    this.draft.showVoters = template.showVoters;
    // targetUserIds intentionally not loaded from template
    await this.render();
  }

  /**
   * Open a dialog for the GM to configure or remove the poll countdown timer.
   * The duration is stored in seconds on the draft; 0 means no timer. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onOpenTimerDialog(event) {
    this._syncDraftFromDom();
    const current = this.draft.duration > 0 ? this.draft.duration : "";

    let result;
    try {
      result = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("VISUAL_POLLS.Timer.DialogTitle"), icon: "fa-solid fa-clock" },
        content: `<div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.25rem 0">
          <label style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;opacity:0.7">
            ${game.i18n.localize("VISUAL_POLLS.Timer.DialogLabel")}
          </label>
          <input type="number" name="duration" min="1" max="3600" step="1" value="${current}"
            placeholder="${game.i18n.localize("VISUAL_POLLS.Timer.Placeholder")}"
            autofocus style="width:100%" />
        </div>`,
        modal: true,
        buttons: [
          {
            action: "set",
            label: game.i18n.localize("VISUAL_POLLS.Timer.Set"),
            icon: "fa-solid fa-check",
            default: true,
            callback: (event, button) => {
              const v = Number(button.form.elements["duration"].value);
              return { do: "set", seconds: (Number.isInteger(v) && v > 0) ? v : 0 };
            }
          },
          {
            action: "remove",
            label: game.i18n.localize("VISUAL_POLLS.Timer.Remove"),
            icon: "fa-solid fa-trash",
            callback: () => ({ do: "remove" })
          },
          {
            action: "cancel",
            label: game.i18n.localize("VISUAL_POLLS.Saved.Cancel"),
            icon: "fa-solid fa-xmark",
            callback: () => null
          }
        ]
      });
    } catch {
      return;
    }

    if (!result) return;
    this.draft.duration = result.do === "set" ? result.seconds : 0;
    await this.render();
  }

  /**
   * Validate the draft and launch the poll for all players. Action handler.
   * @param {PointerEvent} event  The originating click.
   * @returns {Promise<void>}
   */
  async _onStart(event) {
    this._syncDraftFromDom();
    const question = this.draft.question.trim();
    const options = this.draft.options
      .map((o) => ({ text: o.text.trim(), image: o.image || DEFAULT_OPTION_IMAGE }))
      .filter((o) => o.text.length > 0);

    if (!question) {
      ui.notifications.warn(game.i18n.localize("VISUAL_POLLS.Notify.NeedQuestion"));
      return;
    }
    if (options.length < MIN_OPTIONS) {
      ui.notifications.warn(game.i18n.localize("VISUAL_POLLS.Notify.NeedOptions"));
      return;
    }

    await startPoll({
      question,
      options,
      allowMultiple: this.draft.allowMultiple,
      resultsVisible: this.draft.resultsVisible,
      showVoters: this.draft.showVoters,
      targetUserIds: this.draft.targetUserIds,
      duration: this.draft.duration ?? 0
    });
    closeCreator();
  }
}
