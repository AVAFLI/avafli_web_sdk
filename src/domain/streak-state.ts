import { StreakState } from '../types';

/**
 * StreakState utility class for managing streak state
 */
export class StreakStateModel implements StreakState {
  public currentDay: number;
  public lastClaimedDate?: Date;
  public totalEntriesEarned: number;
  public weeklyCurrent: number;
  public weeklyStart?: string;
  public monthlyCurrent: number;
  public monthlyStart?: string;

  constructor(data: Partial<StreakState> = {}) {
    this.currentDay = data.currentDay || 1;
    this.lastClaimedDate = data.lastClaimedDate;
    this.totalEntriesEarned = data.totalEntriesEarned || 0;
    this.weeklyCurrent = data.weeklyCurrent || 0;
    this.weeklyStart = data.weeklyStart;
    this.monthlyCurrent = data.monthlyCurrent || 0;
    this.monthlyStart = data.monthlyStart;
  }

  /**
   * Check if the streak is eligible for a claim today
   */
  public isEligibleToday(): boolean {
    if (!this.lastClaimedDate) return true;
    
    const today = new Date();
    const lastClaim = this.lastClaimedDate;
    
    return (
      today.getUTCFullYear() !== lastClaim.getUTCFullYear() ||
      today.getUTCMonth() !== lastClaim.getUTCMonth() ||
      today.getUTCDate() !== lastClaim.getUTCDate()
    );
  }

  /**
   * Get days since last claim
   */
  public daysSinceLastClaim(): number {
    if (!this.lastClaimedDate) return 0;
    
    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const utc1 = Date.UTC(
      this.lastClaimedDate.getUTCFullYear(), 
      this.lastClaimedDate.getUTCMonth(), 
      this.lastClaimedDate.getUTCDate()
    );
    const utc2 = Date.UTC(
      now.getUTCFullYear(), 
      now.getUTCMonth(), 
      now.getUTCDate()
    );
    
    return Math.floor((utc2 - utc1) / msPerDay);
  }

  /**
   * Check if the streak is broken (gap > 1 day)
   */
  public isBroken(): boolean {
    return this.daysSinceLastClaim() > 1;
  }

  /**
   * Get the next streak day if claimed today
   */
  public getNextDay(): number {
    if (this.isBroken() || !this.lastClaimedDate) {
      return 1;
    }
    // Counter climbs past 7 (Day 8/9/10…); the reward is capped separately at the
    // day-7 ladder value (see Giveaway.getBaseEntries, which clamps the ladder index).
    return this.currentDay + 1;
  }

  /**
   * Add entries to the total
   */
  public addEntries(amount: number): void {
    this.totalEntriesEarned += amount;
  }

  /**
   * Update the state after a successful claim
   */
  public updateAfterClaim(claimDate: Date = new Date()): void {
    this.lastClaimedDate = claimDate;
    this.currentDay = this.getNextDay();
  }

  /**
   * Reset the streak (preserving total entries)
   */
  public reset(): void {
    this.currentDay = 1;
    this.lastClaimedDate = undefined;
    this.weeklyCurrent = 0;
    this.weeklyStart = undefined;
    this.monthlyCurrent = 0;
    this.monthlyStart = undefined;
  }

  /**
   * Serialize to plain object for storage
   */
  public toJSON(): Record<string, unknown> {
    return {
      currentDay: this.currentDay,
      lastClaimedDate: this.lastClaimedDate?.toISOString(),
      totalEntriesEarned: this.totalEntriesEarned,
      weeklyCurrent: this.weeklyCurrent,
      weeklyStart: this.weeklyStart,
      monthlyCurrent: this.monthlyCurrent,
      monthlyStart: this.monthlyStart,
    };
  }

  /**
   * Create StreakStateModel from stored data
   */
  public static fromJSON(data: StreakState & { lastClaimedDate?: string | Date }): StreakStateModel {
    const state = new StreakStateModel(data);
    
    // Handle date parsing
    if (data.lastClaimedDate) {
      state.lastClaimedDate = typeof data.lastClaimedDate === 'string' 
        ? new Date(data.lastClaimedDate)
        : data.lastClaimedDate;
    }
    
    return state;
  }

  /**
   * Create a fresh streak state
   */
  public static createFresh(): StreakStateModel {
    return new StreakStateModel({
      currentDay: 1,
      totalEntriesEarned: 0,
      weeklyCurrent: 0,
      monthlyCurrent: 0,
    });
  }
}