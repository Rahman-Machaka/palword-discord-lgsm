const { t } = require('../i18n.js');

class PalworldApiError extends Error {
    constructor(message, options = {}) {
        super(message, { cause: options.cause });
        this.name = 'PalworldApiError';
        this.kind = options.kind;
        this.status = options.status;
    }
}

function getNetworkErrorCode(error) {
    return error?.cause?.code || error?.code;
}

function classifyApiError(error) {
    const connectionErrorCodes = new Set([
        'ECONNREFUSED',
        'ECONNRESET',
        'ENETUNREACH',
        'EHOSTUNREACH'
    ]);

    if (
        error instanceof PalworldApiError &&
        error.kind === 'network' &&
        connectionErrorCodes.has(getNetworkErrorCode(error.cause))
    ) {
        return 'offline';
    }

    return 'unavailable';
}

function createPalworldApiClient(config) {
    function getAuthHeader() {
        const credentials = `${config.username}:${config.password}`;
        return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    async function request(endpoint, options = {}) {
        let response;

        try {
            response = await fetch(`${config.url}/${endpoint}`, {
                method: options.method || 'GET',
                headers: {
                    Accept: 'application/json',
                    Authorization: getAuthHeader(),
                    ...(options.body === undefined
                        ? {}
                        : { 'Content-Type': 'application/json' })
                },
                body: options.body === undefined
                    ? undefined
                    : JSON.stringify(options.body),
                signal: AbortSignal.timeout(options.timeoutMs || 10_000)
            });
        } catch (error) {
            const isTimeout = error.name === 'TimeoutError';
            throw new PalworldApiError(
                t(
                    isTimeout ? 'api.timeout' : 'api.networkError',
                    { endpoint }
                ),
                {
                    kind: isTimeout ? 'timeout' : 'network',
                    cause: error
                }
            );
        }

        if (!response.ok) {
            throw new PalworldApiError(
                t('api.httpError', {
                    endpoint,
                    status: response.status
                }),
                {
                    kind: 'http',
                    status: response.status
                }
            );
        }

        const responseText = await response.text();

        if (!responseText) {
            return null;
        }

        try {
            return JSON.parse(responseText);
        } catch {
            return responseText;
        }
    }

    async function getStatus() {
        try {
            const [info, metrics, playersResponse] = await Promise.all([
                request('info'),
                request('metrics'),
                request('players')
            ]);
            const players = Array.isArray(playersResponse?.players)
                ? playersResponse.players
                : [];

            return {
                state: 'online',
                online: true,
                serverName: info?.servername || t('api.defaultServerName'),
                version: info?.version || t('api.unknownVersion'),
                currentPlayers:
                    Number(metrics?.currentplayernum) || players.length,
                maxPlayers: Number(metrics?.maxplayernum) || 0,
                serverFps: Number(metrics?.serverfps) || 0,
                uptime: Number(metrics?.uptime) || 0,
                days: Number(metrics?.days) || 0,
                players
            };
        } catch (error) {
            return {
                state: classifyApiError(error),
                online: false,
                error: error.message
            };
        }
    }

    return {
        announce: message => request('announce', {
            method: 'POST',
            body: { message },
            timeoutMs: 30_000
        }),
        getStatus,
        save: () => request('save', {
            method: 'POST',
            timeoutMs: 30_000
        })
    };
}

module.exports = {
    PalworldApiError,
    classifyApiError,
    createPalworldApiClient
};
