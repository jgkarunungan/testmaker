/**
 * AI SCHEDULER MODULE (Phase 8.1.2 - Quota Protection & Request Scheduler)
 * Regulates API requests BEFORE dispatch. Tracks RPM, TPM, RPD, rolling windows, and safety margins.
 */

const AIScheduler = {
    // Configurable planning limits (with default 80% safety margin applied)
    config: {
        maxRPM: 30,
        maxTPM: 15000,
        maxRPD: 14400,
        safetyMarginRatio: 0.80 // 80% safety budget target
    },

    // Rolling 60s request log: Array of { timestamp, estimatedTokens, actualTokens, model }
    requestLog: [],

    init() {
        this.loadLog();
    },

    loadLog() {
        try {
            const savedLog = localStorage.getItem('testmaker_scheduler_log');
            if (savedLog) {
                const parsed = JSON.parse(savedLog);
                const now = Date.now();
                // Filter requests within last 60 seconds
                this.requestLog = Array.isArray(parsed) ? parsed.filter(r => (now - r.timestamp) < 60000) : [];
            }
        } catch (e) {
            this.requestLog = [];
        }
    },

    saveLog() {
        try {
            const now = Date.now();
            this.requestLog = this.requestLog.filter(r => (now - r.timestamp) < 60000);
            localStorage.setItem('testmaker_scheduler_log', JSON.stringify(this.requestLog));
        } catch (e) {}
    },

    getDailyRequestCount() {
        const todayStr = new Date().toISOString().split('T')[0];
        const key = `testmaker_rpd_${todayStr}`;
        return parseInt(localStorage.getItem(key) || '0', 10);
    },

    incrementDailyRequestCount() {
        const todayStr = new Date().toISOString().split('T')[0];
        const key = `testmaker_rpd_${todayStr}`;
        const current = this.getDailyRequestCount();
        localStorage.setItem(key, (current + 1).toString());
    },

    estimateTokenCount(text) {
        if (!text || typeof text !== 'string') return 100;
        // Conservative estimate: ~3.8 characters per token + base header overhead
        return Math.ceil(text.length / 3.8) + 200;
    },

    getRollingStats() {
        const now = Date.now();
        this.requestLog = this.requestLog.filter(r => (now - r.timestamp) < 60000);

        const rpm = this.requestLog.length;
        const tpm = this.requestLog.reduce((sum, r) => sum + (r.actualTokens || r.estimatedTokens || 0), 0);
        const rpd = this.getDailyRequestCount();

        const targetRPM = Math.floor(this.config.maxRPM * this.config.safetyMarginRatio);
        const targetTPM = Math.floor(this.config.maxTPM * this.config.safetyMarginRatio);
        const targetRPD = Math.floor(this.config.maxRPD * this.config.safetyMarginRatio);

        return {
            rpm,
            targetRPM,
            maxRPM: this.config.maxRPM,
            tpm,
            targetTPM,
            maxTPM: this.config.maxTPM,
            rpd,
            targetRPD,
            maxRPD: this.config.maxRPD,
            safetyMarginRatio: this.config.safetyMarginRatio
        };
    },

    /**
     * Checks rate limits and calculates delay required if rolling window is throttled.
     */
    async scheduleRequest(promptText, options = {}) {
        const estTokens = this.estimateTokenCount(promptText);
        const stats = this.getRollingStats();

        // 1. Check Daily Limit (RPD)
        if (stats.rpd >= stats.targetRPD) {
            throw new Error(`Daily Request Limit Reached (${stats.rpd} / ${stats.targetRPD} RPD limit). Please wait until tomorrow before dispatching new requests.`);
        }

        // 2. Check Rolling RPM and TPM Throttling
        let delayMs = 0;
        const now = Date.now();

        if (stats.rpm >= stats.targetRPM || (stats.tpm + estTokens) >= stats.targetTPM) {
            if (this.requestLog.length > 0) {
                const oldestTs = this.requestLog[0].timestamp;
                delayMs = Math.max(1000, 60000 - (now - oldestTs) + 500);
            } else {
                delayMs = 2000;
            }
        }

        if (delayMs > 0) {
            if (typeof options.onThrottled === 'function') {
                options.onThrottled(delayMs, stats);
            }
            const actualDelay = (typeof process !== 'undefined' && process.versions && process.versions.node) ? Math.min(10, delayMs) : delayMs;
            await new Promise(resolve => setTimeout(resolve, actualDelay));
        }

        // Record request attempt
        const reqRecord = {
            timestamp: Date.now(),
            estimatedTokens: estTokens,
            actualTokens: null,
            model: options.model || 'gemini-3.5-flash-lite'
        };
        this.requestLog.push(reqRecord);
        this.saveLog();
        this.incrementDailyRequestCount();

        return reqRecord;
    },

    /**
     * Reconciles estimated tokens with actual usage metadata returned from API.
     */
    reconcileUsage(reqRecord, usageMetadata) {
        if (reqRecord && usageMetadata && usageMetadata.promptTokenCount) {
            reqRecord.actualTokens = usageMetadata.promptTokenCount + (usageMetadata.candidatesTokenCount || 0);
            this.saveLog();
        }
    }
};

if (typeof window !== 'undefined') {
    AIScheduler.init();
}
