import { StreakState, AvafliError, AvafliErrorCode } from '../types';

/**
 * Three-tier streak system engine
 * Handles daily, weekly, and monthly streak calculations
 */
export class StreakEngine {
  /**
   * Calculate the next streak state based on current state and claim date
   */
  public nextState(
    currentState: StreakState | null,
    claimDate: Date = new Date()
  ): { success: true; state: StreakState } | { success: false; error: AvafliError } {
    try {
      // If no existing state, start fresh
      if (!currentState) {
        const currentWeekStart = this.getSundayOfWeek(claimDate);
        const currentMonthFirst = this.getFirstOfMonth(claimDate);
        
        return {
          success: true,
          state: {
            currentDay: 1,
            lastClaimedDate: claimDate,
            totalEntriesEarned: 0,
            weeklyCurrent: 1,
            weeklyStart: currentWeekStart,
            monthlyCurrent: 1,
            monthlyStart: currentMonthFirst,
          },
        };
      }

      // Handle case where lastClaimedDate is missing
      if (!currentState.lastClaimedDate) {
        const currentWeekStart = this.getSundayOfWeek(claimDate);
        const currentMonthFirst = this.getFirstOfMonth(claimDate);
        
        return {
          success: true,
          state: {
            ...currentState,
            currentDay: 1,
            lastClaimedDate: claimDate,
            weeklyCurrent: 1,
            weeklyStart: currentWeekStart,
            monthlyCurrent: 1,
            monthlyStart: currentMonthFirst,
          },
        };
      }

      // Check if already claimed today
      if (this.isSameDay(currentState.lastClaimedDate, claimDate)) {
        return {
          success: false,
          error: new AvafliError(
            AvafliErrorCode.IneligibleToday,
            'Already claimed today'
          ),
        };
      }

      const daysDiff = this.daysBetween(currentState.lastClaimedDate, claimDate);

      // Calculate new daily streak
      const newDailyStreak = daysDiff === 1 
        ? Math.min(currentState.currentDay + 1, 6) // Max 6-day streak
        : 1; // Reset if gap > 1 day

      // Calculate weekly/monthly periods
      const currentWeekStart = this.getSundayOfWeek(claimDate);
      const currentMonthFirst = this.getFirstOfMonth(claimDate);

      // Weekly streak calculation
      let newWeeklyCurrent: number;
      let newWeeklyStart: string;
      if (currentState.weeklyStart === currentWeekStart) {
        // Same week, increment
        newWeeklyCurrent = currentState.weeklyCurrent + 1;
        newWeeklyStart = currentWeekStart;
      } else {
        // New week, reset
        newWeeklyCurrent = 1;
        newWeeklyStart = currentWeekStart;
      }

      // Monthly streak calculation
      let newMonthlyCurrent: number;
      let newMonthlyStart: string;
      if (currentState.monthlyStart === currentMonthFirst) {
        // Same month, increment
        newMonthlyCurrent = currentState.monthlyCurrent + 1;
        newMonthlyStart = currentMonthFirst;
      } else {
        // New month, reset
        newMonthlyCurrent = 1;
        newMonthlyStart = currentMonthFirst;
      }

      return {
        success: true,
        state: {
          currentDay: newDailyStreak,
          lastClaimedDate: claimDate,
          totalEntriesEarned: currentState.totalEntriesEarned,
          weeklyCurrent: newWeeklyCurrent,
          weeklyStart: newWeeklyStart,
          monthlyCurrent: newMonthlyCurrent,
          monthlyStart: newMonthlyStart,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: new AvafliError(
          AvafliErrorCode.InvalidState,
          'Failed to calculate streak state',
          error instanceof Error ? error : undefined
        ),
      };
    }
  }

  /**
   * Get base entries for a given streak day
   */
  public baseEntries(day: number, streakLadder?: number[]): number {
    const ladder = streakLadder || [10, 30, 60, 130, 240, 300];
    const index = Math.max(0, Math.min(day - 1, ladder.length - 1));
    return ladder[index] || 60; // Default fallback
  }

  // ─── Private Helper Methods ───

  private isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getUTCFullYear() === date2.getUTCFullYear() &&
      date1.getUTCMonth() === date2.getUTCMonth() &&
      date1.getUTCDate() === date2.getUTCDate()
    );
  }

  private daysBetween(date1: Date, date2: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    const utc1 = Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate());
    const utc2 = Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate());
    return Math.floor((utc2 - utc1) / msPerDay);
  }

  private getSundayOfWeek(date: Date): string {
    const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const sunday = new Date(date);
    sunday.setUTCDate(date.getUTCDate() - dayOfWeek);
    return this.formatDate(sunday);
  }

  private getFirstOfMonth(date: Date): string {
    const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    return this.formatDate(firstOfMonth);
  }

  private formatDate(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

// Export singleton instance
export const streakEngine = new StreakEngine();