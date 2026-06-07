import { MODULE_ID, SETTING_SFX, SFX_DEFAULT_PATHS, TEMPLATES } from "../constants.js";
import { SfxSettingsModel } from "../sfx.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Settings panel for sound effects. Opened via the module settings menu button.
 * Provides a master volume slider, per-sound enable toggles, and file-picker
 * controls so users can substitute their own audio files.
 * @extends {foundry.applications.api.ApplicationV2}
 */
export class SfxSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "visual-polls-sfx-settings",
    classes: [MODULE_ID, "vp-app"],
    position: { width: 500, height: "auto" },
    window: {
      title: "VISUAL_POLLS.SFX.Title",
      icon: "fa-solid fa-volume-high"
    },
    actions: {
      save: this.prototype._onSave,
      pickFile: this.prototype._onPickFile,
      resetPath: this.prototype._onResetPath,
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.sfxSettings }
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const s = game.settings.get(MODULE_ID, SETTING_SFX);
    return {
      volume: s.volume,
      volumePercent: Math.round(s.volume * 100),
      sounds: [
        {
          id: "hover",
          label: "VISUAL_POLLS.SFX.Hover",
          enabledField: "hoverEnabled",
          pathField: "hoverPath",
          enabled: s.hoverEnabled,
          path: s.hoverPath,
          defaultPath: SFX_DEFAULT_PATHS.hover,
        },
        {
          id: "selectedOption",
          label: "VISUAL_POLLS.SFX.Selected",
          enabledField: "selectedEnabled",
          pathField: "selectedPath",
          enabled: s.selectedEnabled,
          path: s.selectedPath,
          defaultPath: SFX_DEFAULT_PATHS.selectedOption,
        },
        {
          id: "confirmVote",
          label: "VISUAL_POLLS.SFX.Confirm",
          enabledField: "confirmEnabled",
          pathField: "confirmPath",
          enabled: s.confirmEnabled,
          path: s.confirmPath,
          defaultPath: SFX_DEFAULT_PATHS.confirmVote,
        },
        {
          id: "finalResultsWin",
          label: "VISUAL_POLLS.SFX.FinalWin",
          enabledField: "finalWinEnabled",
          pathField: "finalWinPath",
          enabled: s.finalWinEnabled,
          path: s.finalWinPath,
          defaultPath: SFX_DEFAULT_PATHS.finalResultsWin,
          groupLabel: "VISUAL_POLLS.SFX.FinalResultsGroup",
        },
        {
          id: "finalResultsTie",
          label: "VISUAL_POLLS.SFX.FinalTie",
          enabledField: "finalTieEnabled",
          pathField: "finalTiePath",
          enabled: s.finalTieEnabled,
          path: s.finalTiePath,
          defaultPath: SFX_DEFAULT_PATHS.finalResultsTie,
        },
        {
          id: "finalResultsFailure",
          label: "VISUAL_POLLS.SFX.FinalFailure",
          enabledField: "finalFailureEnabled",
          pathField: "finalFailurePath",
          enabled: s.finalFailureEnabled,
          path: s.finalFailurePath,
          defaultPath: SFX_DEFAULT_PATHS.finalResultsFailure,
        },
      ]
    };
  }

  /**
   * Attach a live-update listener to the volume slider so the percentage label
   * reflects the drag position before saving. Called from `_onRender`.
   * @param {object} context
   * @param {object} options
   * @returns {void}
   */
  _onRender(context, options) {
    const volumeInput = this.element.querySelector(".vp-sfx-volume");
    const volumeLabel = this.element.querySelector(".vp-sfx-volume-value");
    if (volumeInput && volumeLabel) {
      volumeInput.addEventListener("input", () => {
        volumeLabel.textContent = `${Math.round(parseFloat(volumeInput.value) * 100)}%`;
      });
    }
  }

  /**
   * Collect every form field and persist the full SFX configuration. Action handler.
   * @param {PointerEvent} event
   * @returns {Promise<void>}
   */
  async _onSave(event) {
    const el = this.element;
    const volume = parseFloat(el.querySelector(".vp-sfx-volume")?.value ?? "0.5");

    const update = { volume };
    for (const cb of el.querySelectorAll("input[type='checkbox'][data-enabled-field]")) {
      update[cb.dataset.enabledField] = cb.checked;
    }
    for (const inp of el.querySelectorAll("input[type='text'][data-path-field]")) {
      update[inp.dataset.pathField] = inp.value;
    }

    await game.settings.set(MODULE_ID, SETTING_SFX, update);
    this.close();
  }

  /**
   * Open a FilePicker scoped to audio files for the targeted sound slot. Action handler.
   * @param {PointerEvent} event
   * @param {HTMLElement} target  Must carry `data-path-field`.
   * @returns {void}
   */
  _onPickFile(event, target) {
    const input = this.element.querySelector(`input[data-path-field="${target.dataset.pathField}"]`);
    const FilePickerClass = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
    new FilePickerClass({
      type: "audio",
      current: input?.value ?? "",
      callback: (path) => {
        if (input) input.value = path;
      }
    }).render(true);
  }

  /**
   * Restore the default bundled path for a sound slot without saving. Action handler.
   * @param {PointerEvent} event
   * @param {HTMLElement} target  Must carry `data-path-field` and `data-default-path`.
   * @returns {void}
   */
  _onResetPath(event, target) {
    const input = this.element.querySelector(`input[data-path-field="${target.dataset.pathField}"]`);
    if (input) input.value = target.dataset.defaultPath;
  }
}
