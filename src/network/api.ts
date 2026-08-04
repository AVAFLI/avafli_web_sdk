import {
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  GetActiveGiveawayResponse,
  ClaimDailyEntriesResponse,
  ClaimBonusEntriesResponse,
  SubmitEmailRequest,
  SubmitEmailResponse,
  SubmitUserProfileRequest,
  SubmitUserProfileResponse,
  SubmitPrizeClaimRequest,
  SubmitPrizeClaimResponse,
  DeleteUserDataResponse,
} from '../types';
import { NetworkClient } from './client';

/**
 * WINR API client with typed endpoints
 */
export class WINRAPI {
  constructor(private client: NetworkClient) {}

  /**
   * Register device and get initial auth tokens
   */
  public async registerDevice(data: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
    return this.client.post<RegisterDeviceResponse>('/registerDevice', data, {
      requiresAuth: false,
    });
  }

  /**
   * Refresh auth token using refresh token
   */
  public async refreshToken(data: RefreshTokenRequest): Promise<RefreshTokenResponse> {
    return this.client.post<RefreshTokenResponse>('/refreshToken', data, {
      requiresAuth: false,
    });
  }

  /**
   * Get active giveaway configuration
   */
  public async getActiveGiveaway(): Promise<GetActiveGiveawayResponse> {
    return this.client.get<GetActiveGiveawayResponse>('/getActiveGiveaway');
  }

  /**
   * Claim daily entries
   */
  public async claimDailyEntries(): Promise<ClaimDailyEntriesResponse> {
    return this.client.post<ClaimDailyEntriesResponse>('/claimDailyEntries', {});
  }

  /**
   * Claim bonus entries (from rewarded video)
   */
  public async claimBonusEntries(): Promise<ClaimBonusEntriesResponse> {
    return this.client.post<ClaimBonusEntriesResponse>('/claimBonusEntries', {});
  }

  /**
   * Submit user email
   */
  public async submitEmail(data: SubmitEmailRequest): Promise<SubmitEmailResponse> {
    return this.client.post<SubmitEmailResponse>('/submitEmail', data);
  }

  /**
   * Submit user profile data
   */
  public async submitUserProfile(data: SubmitUserProfileRequest): Promise<SubmitUserProfileResponse> {
    return this.client.post<SubmitUserProfileResponse>('/submitUserProfile', data);
  }

  /**
   * Submit the drawn winner's prize-claim form (winner flow). Same POST
   * `{data}`/`{result}` callable envelope as every other endpoint.
   */
  public async submitPrizeClaim(data: SubmitPrizeClaimRequest): Promise<SubmitPrizeClaimResponse> {
    return this.client.post<SubmitPrizeClaimResponse>('/submitPrizeClaim', data);
  }

  /**
   * Register push notification token
   */
  public async registerPushToken(data: { token: string; platform: 'web' }): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>('/registerPushToken', data);
  }

  /**
   * Delete all user data (GDPR compliance)
   */
  public async deleteUserData(): Promise<DeleteUserDataResponse> {
    return this.client.post<DeleteUserDataResponse>('/deleteUserData', {});
  }

  /**
   * Health check endpoint
   */
  public async healthCheck(): Promise<{ status: 'ok'; timestamp: number }> {
    return this.client.get<{ status: 'ok'; timestamp: number }>('/health', {
      requiresAuth: false,
      timeout: 5000,
    });
  }
}

/**
 * Factory function to create WINR API client
 */
export function createWINRAPI(client: NetworkClient): WINRAPI {
  return new WINRAPI(client);
}