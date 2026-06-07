import { POLL_STATUS, DEFAULT_OPTION_IMAGE, SHOW_VOTERS } from "./constants.js";

/**
 * The single source of truth for an active poll. Stored as the value of the
 * world setting `activePoll`, so every connected client reads the same shape.
 *
 * Votes are stored as a map of `userId -> number[]` (the chosen option indices)
 * purely to enforce one vote per user and to let a returning client recover its
 * own choice. When `showVoters` is false (the default), only aggregate counts
 * are exposed; when true, voter display names are included in `results`.
 */
export class PollState extends foundry.abstract.DataModel {
  /**
   * @returns {Record<string, foundry.data.fields.DataField>} The poll schema.
   */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      id: new fields.StringField({ required: true, blank: true, initial: "" }),
      question: new fields.StringField({ required: true, blank: true, initial: "" }),
      // Min-option validation lives in the creation form, not here, so the
      // idle/empty default (zero options) remains a valid stored value.
      options: new fields.ArrayField(
        new fields.SchemaField({
          text: new fields.StringField({ required: true, blank: false }),
          image: new fields.StringField({ required: false, blank: true, initial: DEFAULT_OPTION_IMAGE })
        }),
        { initial: [] }
      ),
      allowMultiple: new fields.BooleanField({ initial: false }),
      resultsVisible: new fields.BooleanField({ initial: true }),
      // "none" | "gm" | "all" — who can see the names of voters per option.
      showVoters: new fields.StringField({
        required: true,
        choices: Object.values(SHOW_VOTERS),
        initial: SHOW_VOTERS.NONE
      }),
      status: new fields.StringField({
        required: true,
        choices: Object.values(POLL_STATUS),
        initial: POLL_STATUS.IDLE
      }),
      // Dynamic userId-keyed map; inner array shape is enforced when writing votes.
      votes: new fields.ObjectField({ initial: {} }),
      createdAt: new fields.NumberField({ initial: 0 }),
      // Empty array means the poll targets all players; a non-empty array restricts
      // the display to only the listed user ids (non-GM players only).
      targetUserIds: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }),
        { initial: [] }
      ),
      // Set to true when the GM ends the poll and explicitly shares results with players.
      resultsShared: new fields.BooleanField({ initial: false }),
      // Unix timestamp (ms) when the poll auto-closes. 0 means no timer.
      expiresAt: new fields.NumberField({ nullable: false, min: 0, initial: 0 })
    };
  }

  /**
   * Whether this poll has an active countdown timer configured.
   * @returns {boolean}
   */
  get hasTimer() {
    return this.expiresAt > 0;
  }

  /**
   * Whether a poll is currently being shown to players (open or closed-with-results).
   * @returns {boolean}
   */
  get isActive() {
    return this.status === POLL_STATUS.OPEN || this.status === POLL_STATUS.CLOSED;
  }

  /**
   * Total number of distinct users who have cast a vote.
   * @returns {number}
   */
  get totalVoters() {
    return Object.keys(this.votes).length;
  }

  /**
   * Whether the given user has already voted in this poll.
   * @param {string} userId  The user id to check.
   * @returns {boolean}
   */
  hasVoted(userId) {
    const choice = this.votes[userId];
    return Array.isArray(choice) && choice.length > 0;
  }

  /**
   * Aggregate tally per option. Percentages are share-of-voters, so for
   * multi-select polls the values can legitimately sum above 100%.
   * Voter display names are always collected; callers filter `voters` / `hasVoters`
   * based on `showVoters` and whether the current user is a GM.
   * @returns {Array<{index: number, text: string, count: number, percent: number, voters: string[], hasVoters: boolean}>}
   */
  get results() {
    const voterIds = Object.keys(this.votes);
    const total = voterIds.length;
    return this.options.map((option, index) => {
      let count = 0;
      const voters = [];
      for (const id of voterIds) {
        if (this.votes[id]?.includes(index)) {
          count++;
          const user = game.users?.get(id);
          voters.push(user?.name ?? id);
        }
      }
      return {
        index,
        text: option.text,
        image: option.image,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0,
        voters,
        hasVoters: voters.length > 0
      };
    });
  }
}
