/**
 * Macro-Economics — The Emerald Standard.
 *
 * Tracks:
 *   - Agent wallets (emerald balances)
 *   - GDP (total economic output)
 *   - Gini coefficient (wealth inequality)
 *   - Market prices with supply/demand dynamics
 *   - Trade history and disputes
 */

class TownBank {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.wallets = new Map();     // agentId → balance
    this.gdpHistory = [];         // { timestamp, totalWealth, gdp, gini }
    this.tradeLog = [];           // recent trades
    this.disputes = [];           // unresolved trade disputes
    this.basePrices = {
      food: 1,
      wood: 2,
      stone: 4,
      iron: 8,
      gold: 16,
      diamond: 32,
      emerald: 1,
    };
    this.marketPrices = { ...this.basePrices };
    this.supplyLevels = {
      food: 100,
      wood: 80,
      stone: 60,
      iron: 30,
      gold: 10,
      diamond: 5,
    };
    this.totalEmeraldsInjected = 0;
    this.lastGdpSnapshot = Date.now();
  }

  initWallet(agentId, startingBalance) {
    if (!this.wallets.has(agentId)) {
      this.wallets.set(agentId, startingBalance || 10);
    }
  }

  getBalance(agentId) {
    return this.wallets.get(agentId) || 0;
  }

  transfer(fromId, toId, amount) {
    const fromBal = this.getBalance(fromId);
    if (fromBal < amount) return { success: false, reason: 'Insufficient funds' };

    this.wallets.set(fromId, fromBal - amount);
    this.wallets.set(toId, (this.wallets.get(toId) || 0) + amount);

    const trade = {
      id: this.tradeLog.length,
      from: fromId,
      to: toId,
      amount,
      timestamp: Date.now(),
      type: 'transfer',
    };
    this.tradeLog.push(trade);
    if (this.tradeLog.length > 500) this.tradeLog.splice(0, this.tradeLog.length - 500);

    this.eventBus.emit('economy:transfer', trade);
    return { success: true, trade };
  }

  payWage(employerId, workerId, amount) {
    return this.transfer(employerId, workerId, amount);
  }

  collectTax(agentId, amount) {
    const bal = this.getBalance(agentId);
    const taxed = Math.min(bal, amount);
    this.wallets.set(agentId, bal - taxed);
    return taxed;
  }

  injectEmeralds(agentId, amount) {
    this.wallets.set(agentId, (this.wallets.get(agentId) || 0) + amount);
    this.totalEmeraldsInjected += amount;
    this.updateInflation();
    this.eventBus.emit('economy:injection', { agentId, amount });
  }

  attemptScam(scammerId, victimId, amount, scammerGreed) {
    // High greed → higher chance of attempting a scam
    const scamSuccess = Math.random() < scammerGreed * 0.5;
    const victimBal = this.getBalance(victimId);

    if (scamSuccess && victimBal >= amount) {
      this.wallets.set(victimId, victimBal - amount);
      this.wallets.set(scammerId, (this.wallets.get(scammerId) || 0) + amount);

      const dispute = {
        id: this.disputes.length,
        type: 'fraud',
        scammerId,
        victimId,
        amount,
        resolved: false,
        timestamp: Date.now(),
      };
      this.disputes.push(dispute);
      this.eventBus.emit('economy:scam', dispute);
      return { success: true, dispute };
    }

    return { success: false, caught: Math.random() < 0.5 };
  }

  resolveDispute(disputeId, verdict) {
    const dispute = this.disputes[disputeId];
    if (!dispute || dispute.resolved) return null;

    dispute.resolved = true;
    dispute.verdict = verdict;

    if (verdict === 'refund') {
      this.transfer(dispute.scammerId, dispute.victimId, dispute.amount);
    }

    this.eventBus.emit('economy:dispute_resolved', dispute);
    return dispute;
  }

  updateInflation() {
    const inflationFactor = 1 + (this.totalEmeraldsInjected / 1000) * 0.1;
    for (const item of Object.keys(this.basePrices)) {
      if (item !== 'emerald') {
        this.marketPrices[item] = Math.round(this.basePrices[item] * inflationFactor * 100) / 100;
      }
    }
  }

  getPrice(item) {
    return this.marketPrices[item] || 1;
  }

  updateSupply(item, delta) {
    if (this.supplyLevels[item] !== undefined) {
      this.supplyLevels[item] = Math.max(0, this.supplyLevels[item] + delta);
      // Supply/demand: lower supply → higher price
      const supplyFactor = Math.max(0.5, 100 / Math.max(1, this.supplyLevels[item]));
      this.marketPrices[item] = Math.round(this.marketPrices[item] * supplyFactor * 10) / 10;
    }
  }

  calculateGini() {
    const balances = Array.from(this.wallets.values()).sort((a, b) => a - b);
    const n = balances.length;
    if (n === 0) return 0;

    const totalWealth = balances.reduce((s, v) => s + v, 0);
    if (totalWealth === 0) return 0;

    let sumOfDiffs = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sumOfDiffs += Math.abs(balances[i] - balances[j]);
      }
    }

    return Math.round((sumOfDiffs / (2 * n * n * (totalWealth / n))) * 1000) / 1000;
  }

  snapshotGDP() {
    const balances = Array.from(this.wallets.values());
    const totalWealth = balances.reduce((s, v) => s + v, 0);
    const gdp = this.tradeLog
      .filter((t) => t.timestamp > this.lastGdpSnapshot)
      .reduce((s, t) => s + t.amount, 0);

    const snapshot = {
      timestamp: Date.now(),
      totalWealth,
      gdp,
      gini: this.calculateGini(),
      agentCount: this.wallets.size,
      avgWealth: balances.length > 0 ? Math.round((totalWealth / balances.length) * 100) / 100 : 0,
      totalInjected: this.totalEmeraldsInjected,
    };

    this.gdpHistory.push(snapshot);
    if (this.gdpHistory.length > 360) this.gdpHistory.splice(0, this.gdpHistory.length - 360);
    this.lastGdpSnapshot = Date.now();

    this.eventBus.emit('economy:gdp_snapshot', snapshot);
    return snapshot;
  }

  getStatus() {
    const balances = Array.from(this.wallets.values());
    return {
      totalWealth: balances.reduce((s, v) => s + v, 0),
      gini: this.calculateGini(),
      gdpHistory: this.gdpHistory.slice(-60),
      recentTrades: this.tradeLog.slice(-30),
      openDisputes: this.disputes.filter((d) => !d.resolved),
      marketPrices: { ...this.marketPrices },
      supplyLevels: { ...this.supplyLevels },
      agentCount: this.wallets.size,
    };
  }

  getAgentWealth(agentId) {
    const balance = this.getBalance(agentId);
    const allBalances = Array.from(this.wallets.values()).sort((a, b) => a - b);
    const rank = allBalances.filter((b) => b <= balance).length;
    const percentile = allBalances.length > 0 ? rank / allBalances.length : 0.5;
    return { balance, percentile, rank, total: allBalances.length };
  }
}

module.exports = { TownBank };
