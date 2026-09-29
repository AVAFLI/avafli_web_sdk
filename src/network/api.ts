import {
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  GetActiveGiveawayResponse,
  ClaimDailyEntriesResponse,
  SubmitEmailRequest,
  SubmitEmailResponse,
  SubmitUserProfileRequest,
  SubmitUserProfileResponse,
  SubmitPrizeClaimRequest,
  SubmitPrizeClaimResponse,
  SendClaimVerificationCodeRequest,
  SendClaimVerificationCodeResponse,
  ConfirmClaimVerificationCodeRequest,
  ConfirmClaimVerificationCodeResponse,
} from '../types';
import { NetworkClient } from './client';
import { getPerimeterToken } from '../perimeter';

/**
 * Avafli API client with typed endpoints
 */
export class AvafliAPI {
  constructor(private client: NetworkClient) {}

  /**
   * Register device and get initial auth tokens
   */
  public async registerDevice(data: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
    // Browser perimeter token. Undefined whenever reCAPTCHA is unavailable — a
    // publisher CSP that blocks Google, an offline first load, a slow network —
    // and registration proceeds regardless. The backend grades its absence; the
    // SDK never withholds the experience over it.
    const perimeterToken = await getPerimeterToken('register');
    return this.client.post<RegisterDeviceResponse>(
      '/registerDevice',
      perimeterToken ? { ...data, perimeterToken } : data,
      { requiresAuth: false },
    );
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
    // 3.2.0: every submit declares that this client knows the
    // email-ownership step (see SubmitPrizeClaimRequest).
    return this.client.post<SubmitPrizeClaimResponse>('/submitPrizeClaim', {
      ...data,
      supportsClaimVerification: true,
    });
  }

  /**
   * Sends (or re-uses) the winner's six-digit claim code (3.2.0). Without
   * `resend` it is idempotent — a live code is re-used and `sent` is false —
   * so it is safe to call every time the code screen opens.
   *
   * One automatic retry only (the 401 → token-refresh path needs it): a
   * failed send surfaces inline with its own Retry instead of being re-sent
   * behind the person's back.
   */
  public async sendClaimVerificationCode(
    data: SendClaimVerificationCodeRequest
  ): Promise<SendClaimVerificationCodeResponse> {
    return this.client.post<SendClaimVerificationCodeResponse>(
      '/sendClaimVerificationCode',
      data,
      { retries: 2 }
    );
  }

  /**
   * Checks the six-digit claim code (3.2.0). Failures carry a machine-readable
   * `details.reason` on the thrown AvafliError (`code_mismatch`,
   * `fresh_code_sent`, …).
   */
  public async confirmClaimVerificationCode(
    data: ConfirmClaimVerificationCodeRequest
  ): Promise<ConfirmClaimVerificationCodeResponse> {
    return this.client.post<ConfirmClaimVerificationCodeResponse>(
      '/confirmClaimVerificationCode',
      data,
      { retries: 2 }
    );
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
 * Factory function to create Avafli API client
 */
export function createAvafliAPI(client: NetworkClient): AvafliAPI {
  return new AvafliAPI(client);
}