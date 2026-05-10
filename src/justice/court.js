/**
 * Justice System — Laws, Crimes, Trials, Jail, and Rehabilitation.
 *
 * Handles:
 *   - Crime detection and bounty posting
 *   - Arrest logic (Guards hunt bounty targets)
 *   - Courtroom trials with witness evidence from Redis
 *   - Jail sentences with rehabilitation vs. radicalization
 */

const laws = require('./laws.json');
const { think } = require('../llm/client');
const memory = require('../memory/store');
const { applyTraitEvent } = require('../systems/traitEvolution');

class JusticeSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.bounties = [];          // { targetId, targetName, crime, reportedBy, timestamp }
    this.inmates = new Map();    // agentId → { crime, sentence, startedAt, endsAt }
    this.trialLog = [];          // completed trials
    this.activeTrial = null;     // current trial in progress
  }

  reportCrime(reporterId, reporterName, targetId, targetName, crimeType, evidence) {
    const crimeDef = laws.legalCode.crimes[crimeType];
    if (!crimeDef) return null;

    const bounty = {
      id: this.bounties.length,
      targetId,
      targetName,
      crime: crimeType,
      crimeName: crimeDef.name,
      severity: crimeDef.severity,
      reportedBy: reporterName,
      reporterId,
      evidence: evidence || [],
      timestamp: Date.now(),
      status: 'active',
    };

    this.bounties.push(bounty);
    this.eventBus.emit('justice:bounty', bounty);
    return bounty;
  }

  arrest(agentId, bountyId) {
    const bounty = this.bounties[bountyId];
    if (!bounty || bounty.status !== 'active') return null;

    bounty.status = 'arrested';
    this.eventBus.emit('justice:arrest', { agentId, bounty });
    return bounty;
  }

  async conductTrial(accusedSoul, accusedId, bounty) {
    const crimeDef = laws.legalCode.crimes[bounty.crime];
    if (!crimeDef) return null;

    // Gather evidence from memory
    const [accusedMemories, accusedGossip] = await Promise.all([
      memory.getMemories(accusedId, 10),
      memory.getGossip(accusedId, 5),
    ]);

    const trialPrompt = `You are the Arbiter (Judge) of Aetheria. You must conduct a fair trial.

THE ACCUSED: ${accusedSoul.name} (${accusedSoul.archetype})
CRIME: ${crimeDef.name} — ${crimeDef.description}
SEVERITY: ${crimeDef.severity}
REPORTED BY: ${bounty.reportedBy}

EVIDENCE PRESENTED:
${bounty.evidence.map((e) => `- ${e}`).join('\n') || '- No direct evidence presented'}

ACCUSED'S RECENT MEMORY LOG:
${accusedMemories.map((m) => `- ${m.text}`).join('\n') || '- No memories available'}

GOSSIP ABOUT THE ACCUSED:
${accusedGossip.map((g) => `- ${g.from}: "${g.rumor}"`).join('\n') || '- No gossip available'}

ACCUSED'S TRAITS:
- Loyalty: ${accusedSoul.traits.loyalty}
- Greed: ${accusedSoul.traits.greed}
- Aggression: ${accusedSoul.traits.aggression}
- Rebellion: ${accusedSoul.traits.rebellion || 0.1}

LEGAL CODE REQUIRES: ${crimeDef.evidence_required.join(', ')}
SENTENCE RANGE: ${crimeDef.minSentence}s to ${crimeDef.maxSentence}s
FINE: ${crimeDef.fine} emeralds

Respond with JSON only:
{
  "verdict": "guilty" or "innocent",
  "reasoning": "Your judicial reasoning (2-3 sentences)",
  "sentence_seconds": number (0 if innocent),
  "fine_emeralds": number (0 if innocent),
  "speech": "What you announce to the court"
}`;

    const systemPrompt = 'You are a stern but fair judge. Weigh evidence carefully. Respond with JSON only.';
    const raw = await think(systemPrompt, trialPrompt);

    let verdict;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      verdict = JSON.parse(cleaned);
    } catch {
      verdict = {
        verdict: 'innocent',
        reasoning: 'Insufficient evidence to convict.',
        sentence_seconds: 0,
        fine_emeralds: 0,
        speech: 'The court finds insufficient evidence. Case dismissed.',
      };
    }

    const trial = {
      id: this.trialLog.length,
      accusedId,
      accusedName: accusedSoul.name,
      crime: bounty.crime,
      crimeName: crimeDef.name,
      verdict: verdict.verdict,
      reasoning: verdict.reasoning,
      sentence: verdict.sentence_seconds,
      fine: verdict.fine_emeralds,
      speech: verdict.speech,
      timestamp: Date.now(),
    };

    this.trialLog.push(trial);
    bounty.status = verdict.verdict === 'guilty' ? 'convicted' : 'acquitted';

    // If guilty, jail them
    if (verdict.verdict === 'guilty' && verdict.sentence_seconds > 0) {
      this.jail(accusedId, bounty.crime, verdict.sentence_seconds);
      await applyTraitEvent(accusedSoul, 'jailed');
    }

    this.eventBus.emit('justice:trial', trial);
    return trial;
  }

  jail(agentId, crime, durationSeconds) {
    const entry = {
      crime,
      sentence: durationSeconds,
      startedAt: Date.now(),
      endsAt: Date.now() + durationSeconds * 1000,
    };
    this.inmates.set(agentId, entry);
    this.eventBus.emit('justice:jailed', { agentId, ...entry });
    return entry;
  }

  checkRelease(agentId) {
    const inmate = this.inmates.get(agentId);
    if (!inmate) return null;
    if (Date.now() >= inmate.endsAt) {
      this.inmates.delete(agentId);
      return 'released';
    }
    return 'serving';
  }

  async processRelease(soul) {
    // Rehabilitation vs. radicalization based on traits
    const rebellionChance = (soul.traits.rebellion || 0.1) + (soul.traits.aggression || 0) * 0.3;
    const isRadicalized = Math.random() < rebellionChance;

    if (isRadicalized) {
      await applyTraitEvent(soul, 'jailed'); // Further radicalize
      return 'vengeful';
    } else {
      await applyTraitEvent(soul, 'reformed');
      return 'reformed';
    }
  }

  isJailed(agentId) {
    return this.inmates.has(agentId);
  }

  getActiveBounties() {
    return this.bounties.filter((b) => b.status === 'active');
  }

  getStatus() {
    return {
      bounties: this.bounties.slice(-50),
      activeBounties: this.getActiveBounties(),
      inmates: Array.from(this.inmates.entries()).map(([id, data]) => ({
        agentId: id,
        ...data,
        remainingSeconds: Math.max(0, Math.floor((data.endsAt - Date.now()) / 1000)),
      })),
      recentTrials: this.trialLog.slice(-20),
      activeTrial: this.activeTrial,
    };
  }
}

module.exports = { JusticeSystem };
