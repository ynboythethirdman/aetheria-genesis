/**
 * Lore Keeper — Auto-generating world history using LLM.
 *
 * Summarizes the last hour of simulation events into narrative "Chapters."
 */

const { think } = require('../llm/client');

class LoreKeeper {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.chapters = [];
    this.eventBuffer = [];
    this.lastChapterTime = Date.now();
    this.chapterInterval = 3600000; // 1 hour

    this.eventBus.on('agent:tick', (e) => this.bufferEvent('tick', e));
    this.eventBus.on('gossip:spread', (e) => this.bufferEvent('gossip', e));
    this.eventBus.on('god:event', (e) => this.bufferEvent('god_event', e));
    this.eventBus.on('justice:trial', (e) => this.bufferEvent('trial', e));
    this.eventBus.on('justice:arrest', (e) => this.bufferEvent('arrest', e));
    this.eventBus.on('economy:scam', (e) => this.bufferEvent('scam', e));
    this.eventBus.on('economy:gdp_snapshot', (e) => this.bufferEvent('economy', e));
    this.eventBus.on('prayer:received', (e) => this.bufferEvent('prayer', e));
  }

  bufferEvent(type, data) {
    this.eventBuffer.push({
      type,
      summary: this.summarizeEvent(type, data),
      timestamp: Date.now(),
    });
    if (this.eventBuffer.length > 200) this.eventBuffer.splice(0, this.eventBuffer.length - 200);
  }

  summarizeEvent(type, data) {
    switch (type) {
      case 'tick': return `${data.name} thought: "${(data.thought || '').slice(0, 80)}" and chose to ${data.action}`;
      case 'gossip': return `${data.source} spread a rumor: "${(data.rumor || '').slice(0, 80)}"`;
      case 'god_event': return `Divine event: ${data.event}`;
      case 'trial': return `Trial: ${data.accusedName} was found ${data.verdict} of ${data.crimeName}`;
      case 'arrest': return `${data.bounty.targetName} was arrested for ${data.bounty.crimeName}`;
      case 'scam': return `A scam was detected involving ${data.amount} emeralds`;
      case 'economy': return `GDP snapshot: total wealth ${data.totalWealth}, Gini: ${data.gini}`;
      case 'prayer': return `${data.agentName} prayed: "${(data.prayer || '').slice(0, 80)}"`;
      default: return `${type} event occurred`;
    }
  }

  async generateChapter() {
    if (this.eventBuffer.length < 5) return null;

    const events = this.eventBuffer.slice(-100);
    const uniqueEvents = events
      .filter((e) => e.type !== 'tick' || Math.random() < 0.2) // Sample ticks
      .map((e) => `[${new Date(e.timestamp).toISOString().slice(11, 19)}] ${e.summary}`)
      .join('\n');

    const prompt = `You are the Lore Keeper of Aetheria, a civilization of 100 autonomous agents.
Write a dramatic, narrative chapter summarizing the following events. Write it as if you are a historian chronicling this civilization. Include drama, intrigue, and character moments. Keep it to 2-3 paragraphs.

Chapter ${this.chapters.length + 1}

EVENTS:
${uniqueEvents}

Write the chapter now. Be vivid and dramatic.`;

    const raw = await think('You are an eloquent historian and storyteller.', prompt);
    const chapter = {
      number: this.chapters.length + 1,
      title: `Chapter ${this.chapters.length + 1}: The ${this.getChapterTheme(events)}`,
      content: raw,
      eventCount: events.length,
      generatedAt: Date.now(),
    };

    this.chapters.push(chapter);
    if (this.chapters.length > 24) this.chapters.splice(0, this.chapters.length - 24);
    this.eventBuffer = [];
    this.lastChapterTime = Date.now();

    this.eventBus.emit('lore:chapter', chapter);
    return chapter;
  }

  getChapterTheme(events) {
    const types = events.map((e) => e.type);
    if (types.includes('trial')) return 'Scales of Justice';
    if (types.includes('god_event')) return 'Divine Intervention';
    if (types.includes('scam')) return 'Age of Deceit';
    if (types.includes('prayer')) return 'Whispers to the Sky';
    if (types.filter((t) => t === 'gossip').length > 5) return 'Web of Rumors';
    return 'Turning of the Wheel';
  }

  shouldGenerateChapter() {
    return Date.now() - this.lastChapterTime >= this.chapterInterval && this.eventBuffer.length >= 5;
  }

  getChapters() {
    return this.chapters;
  }
}

module.exports = { LoreKeeper };
