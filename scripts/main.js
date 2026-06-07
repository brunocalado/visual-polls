import { MODULE_ID } from "./constants.js";
import {
  registerSettings,
  registerQueries,
  initClient,
  openCreator,
  startPoll,
  endPoll,
  clearPoll
} from "./poll-controller.js";

/**
 * Register settings and the vote query before the game is ready.
 * `init` hook.
 */
Hooks.once("init", () => {
  registerSettings();
  registerQueries();
});

/**
 * Expose a small public API and reconcile any in-progress poll for this client
 * (covers reloads and players joining mid-poll). `ready` hook.
 */
Hooks.once("ready", () => {
  const api = { openCreator, startPoll, endPoll, clearPoll };
  game.modules.get(MODULE_ID).api = api;

  // Convenience global so GMs can call VisualPolls.openCreator() from macros.
  globalThis.VisualPolls = api;

  initClient();
});

/**
 * Add a GM-only launcher button to the Notes scene controls so a poll can be
 * created directly from the canvas toolbar. `getSceneControlButtons` hook.
 * @param {object} controls  The scene controls object keyed by control name.
 * @returns {void}
 */
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const notesControl = controls.notes;
  if (!notesControl) return;

  notesControl.tools.createPoll = {
    name: "createPoll",
    title: game.i18n.localize("VISUAL_POLLS.Launch"),
    icon: "fa-solid fa-square-poll-vertical",
    button: true,
    onChange: () => openCreator()
  };
});
