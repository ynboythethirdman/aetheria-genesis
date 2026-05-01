/**
 * Prayer System — Agents in despair can pray to the God-User.
 *
 * High-superstition agents in desperate need states send prayers
 * that appear as priority alerts on the dashboard.
 */

class PrayerSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.prayers = [];       // All prayers
    this.unanswered = [];    // Pending prayers awaiting divine response
    this.nextPrayerId = 0;
  }

  pray(soul, reason, needs) {
    const prayer = {
      id: this.nextPrayerId++,
      agentId: soul.id,
      agentName: soul.name,
      archetype: soul.archetype,
      prayer: reason,
      superstition: soul.traits.superstition,
      desperation: needs ? (1 - Math.min(needs.hunger, needs.safety)) : 0.5,
      timestamp: Date.now(),
      answered: false,
      response: null,
    };

    this.prayers.push(prayer);
    if (this.prayers.length > 200) this.prayers.splice(0, this.prayers.length - 200);
    this.unanswered.push(prayer);

    this.eventBus.emit('prayer:received', prayer);
    return prayer;
  }

  answerPrayer(prayerId, response) {
    let prayer = this.prayers.find((p) => p.id === prayerId);
    if (!prayer) prayer = this.unanswered.find((p) => p.id === prayerId);
    if (!prayer) return null;

    prayer.answered = true;
    prayer.response = response;
    prayer.answeredAt = Date.now();
    this.unanswered = this.unanswered.filter((p) => p.id !== prayerId);

    this.eventBus.emit('prayer:answered', { prayer, response });
    return prayer;
  }

  shouldPray(soul, needs) {
    if (!needs) return false;
    const isDesparate = needs.hunger < 0.2 || needs.safety < 0.2;
    const isSuperstitious = soul.traits.superstition > 0.5;
    return isDesparate && isSuperstitious && Math.random() < soul.traits.superstition * 0.3;
  }

  getUnanswered() {
    return this.unanswered;
  }

  getStatus() {
    return {
      totalPrayers: this.prayers.length,
      unanswered: this.unanswered,
      recentPrayers: this.prayers.slice(-20),
    };
  }
}

module.exports = { PrayerSystem };
