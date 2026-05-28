// License Manager — Shared module for Gumroad license verification
// Version 1.0 — Works in Chrome extension popup/background context
// Requires chrome.storage.local (MV3 service worker compatible)

/**
 * USAGE:
 *   1. Set window.LICENSE_CONFIG before calling any method:
 *      window.LICENSE_CONFIG = { productName, productPermalink, trialLimit, accentColor, gumroadUrl };
 *   2. Call await LicenseManager.init() to load persisted state
 *   3. Call await LicenseManager.canUse() before any gated feature
 *   4. Call LicenseManager.showActivationDialog() when access is blocked
 */

const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';
const REFUND_CHECK_DAYS = 7;

const STORAGE = {
  TRIAL_COUNT: 'lm_trial_count',
  LICENSE_KEY: 'lm_license_key',
  ACTIVATED:   'lm_activated',
  LAST_VERIFY: 'lm_last_verify',
  DEVICE_ID:   'lm_device_id'
};

const LicenseManager = (() => {
  let _config = null;
  let _status = null;  // { activated, used, limit, remaining }

  // ─── storage helpers (chrome.storage.local) ───
  async function _get(key) {
    const data = await chrome.storage.local.get(key);
    return data[key];
  }

  async function _set(obj) {
    await chrome.storage.local.set(obj);
  }

  async function _remove(keys) {
    await chrome.storage.local.remove(keys);
  }

  // ─── device fingerprint ───
  async function _deviceId() {
    let id = await _get(STORAGE.DEVICE_ID);
    if (!id) {
      const chars = 'abcdefghijklmnopqrstuvwxyz012345678'; // 36 chars
      const a = new Uint32Array(8);
      crypto.getRandomValues(a);
      id = Array.from(a).map(n => chars[n % chars.length]).join('');
      await _set({ [STORAGE.DEVICE_ID]: id });
    }
    return id;
  }

  // ─── public API ───
  return {
    /**
     * Initialize the license manager with product config.
     * Must be called once before any other method.
     */
    async init(config) {
      _config = config || window.LICENSE_CONFIG || {};
      if (!_config.productPermalink) {
        console.error('[LicenseManager] Missing productPermalink in config');
      }
      _status = {
        activated: await this.isActivated(),
        used:      await this.getTrialCount(),
        limit:     _config.trialLimit || 5,
        remaining: 0
      };
      _status.remaining = Math.max(0, _status.limit - _status.used);
      return _status;
    },

    /** Check whether the feature is accessible now */
    async canUse() {
      if (!_status) await this.init();
      if (_status.activated) return { allowed: true, reason: 'activated', ..._status };

      if (_status.used < _status.limit) {
        // Grant trial access and increment counter
        const n = await this.incrementTrial();
        _status.used = n;
        _status.remaining = Math.max(0, _status.limit - n);
        return { allowed: true, reason: 'trial', ..._status };
      }
      return { allowed: false, reason: 'trial_exhausted', ..._status };
    },

    async getTrialCount() {
      const c = await _get(STORAGE.TRIAL_COUNT);
      return c !== undefined ? parseInt(c, 10) : 0;
    },

    async incrementTrial() {
      const c = await this.getTrialCount();
      const n = c + 1;
      await _set({ [STORAGE.TRIAL_COUNT]: String(n) });
      return n;
    },

    async isActivated() {
      return (await _get(STORAGE.ACTIVATED)) === 'true';
    },

    /**
     * Verify a license key with Gumroad.
     * Returns { valid, email?, error? }
     */
    async verifyLicense(key) {
      if (!_config || !_config.productPermalink) {
        return { valid: false, error: 'License system not configured.' };
      }

      try {
        const body = `product_permalink=${encodeURIComponent(_config.productPermalink)}&license_key=${encodeURIComponent(key.trim())}`;
        const resp = await fetch(GUMROAD_VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body
        });

        const data = await resp.json();

        if (!data.success) {
          return { valid: false, error: 'Invalid license key. Please check and try again.' };
        }

        if (data.purchase && (data.purchase.refunded || data.purchase.disputed || data.purchase.chargebacked)) {
          return { valid: false, error: 'This license has been refunded or canceled.' };
        }

        // Device limit: reject if already used on 2+ devices
        if (data.uses !== undefined && data.uses >= 2) {
          return { valid: false, error: 'This license has already been used on 2 devices. Please purchase an additional license.' };
        }

        // Increment uses to record this device
        try {
          await fetch(GUMROAD_VERIFY_URL.replace('/verify', '/increment_uses'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
          });
        } catch (e) { /* non-blocking */ }

        // Activate locally
        await _set({
          [STORAGE.LICENSE_KEY]:  key.trim(),
          [STORAGE.ACTIVATED]:    'true',
          [STORAGE.LAST_VERIFY]:  String(Date.now())
        });
        _status.activated = true;

        return { valid: true, email: data.purchase?.email };
      } catch (e) {
        return { valid: false, error: 'Network error. Please check your connection and try again.' };
      }
    },

    /** Periodic refund check (call once per session) */
    async checkRefund() {
      if (!(await this.isActivated())) return;

      const last = await _get(STORAGE.LAST_VERIFY);
      const now = Date.now();
      if (last && now - parseInt(last) < REFUND_CHECK_DAYS * 86400000) return;

      const key = await _get(STORAGE.LICENSE_KEY);
      if (!key) return;

      try {
        const result = await this.verifyLicense(key);
        if (!result.valid) {
          await _remove([STORAGE.LICENSE_KEY, STORAGE.ACTIVATED, STORAGE.LAST_VERIFY]);
          _status.activated = false;
        }
      } catch (e) {
        // Graceful degradation: don't deactivate on network error
      }
    },

    getStatus() {
      return _status ? { ..._status } : { activated: false, used: 0, limit: 5, remaining: 5 };
    }
  };
})();