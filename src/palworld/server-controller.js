const { t } = require('../i18n.js');
const {
    createLocalExecutor
} = require('../execution/command-executor.js');

class ServerActionBusyError extends Error {
    constructor() {
        super(t('controller.actionBusy'));
        this.name = 'ServerActionBusyError';
    }
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function normalizeVersion(value) {
    const match = String(value || '').match(/\d+(?:\.\d+){1,2}/);
    return match ? match[0] : null;
}

function isNewerVersion(currentVersion, latestVersion) {
    const current = currentVersion.split('.').map(Number);
    const latest = latestVersion.split('.').map(Number);
    const length = Math.max(current.length, latest.length);

    for (let index = 0; index < length; index += 1) {
        const difference = (latest[index] || 0) - (current[index] || 0);

        if (difference !== 0) {
            return difference > 0;
        }
    }

    return false;
}

function isPalworldUpdateAvailable(output) {
    const normalizedOutput = String(output || '')
        .replace(/\u001b\[[0-9;]*m/g, '')
        .toLowerCase();
    const noUpdatePatterns = [
        'no update available',
        'no update required',
        'already up to date',
        'already up-to-date'
    ];

    if (noUpdatePatterns.some(pattern => normalizedOutput.includes(pattern))) {
        return false;
    }

    return normalizedOutput.includes('update available') ||
        normalizedOutput.includes('update required');
}

function createServerController({
    apiClient,
    linuxGsm,
    commandExecutor = createLocalExecutor(),
    isExternalActionRunning = () => false
}) {
    let actionRunning = false;

    async function runLinuxGsmCommand(command) {
        const commandTimeouts = {
            start: 120_000,
            stop: 120_000,
            'check-update': 300_000,
            'update-lgsm': 300_000,
            update: 900_000
        };

        if (!Object.prototype.hasOwnProperty.call(commandTimeouts, command)) {
            throw new Error(t('controller.commandNotAllowed', { command }));
        }

        const useRunuser = linuxGsm.useRunuser !== false;
        const executable = useRunuser
            ? '/usr/sbin/runuser'
            : linuxGsm.script;
        const args = useRunuser
            ? ['-u', linuxGsm.user, '--', linuxGsm.script, command]
            : [command];
        const { stdout, stderr } = await commandExecutor.execute(
            executable,
            args,
            {
                cwd: linuxGsm.cwd,
                timeout: commandTimeouts[command],
                maxBuffer: 2 * 1024 * 1024
            }
        );

        if (stdout) {
            console.log(t('log.linuxGsm', { command }), stdout.trim());
        }

        if (stderr) {
            console.warn(t('log.linuxGsm', { command }), stderr.trim());
        }

        return { stdout, stderr };
    }

    async function waitForState(expectedState, timeoutMs = 120_000) {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const status = await apiClient.getStatus();

            if (status.state === expectedState) {
                return;
            }

            await sleep(5_000);
        }

        const expectedLabel = expectedState === 'online'
            ? t('controller.stateOnline')
            : t('controller.stateOffline');
        throw new Error(t('controller.stateTimeout', {
            state: expectedLabel
        }));
    }

    async function runExclusive(action) {
        if (actionRunning || isExternalActionRunning()) {
            throw new ServerActionBusyError();
        }

        actionRunning = true;

        try {
            return await action();
        } finally {
            actionRunning = false;
        }
    }

    async function startOfflineServer() {
        await runLinuxGsmCommand('start');
        await waitForState('online');
    }

    async function saveAndStopOnlineServer() {
        await apiClient.save();
        await sleep(10_000);
        await runLinuxGsmCommand('stop');
        await waitForState('offline');
    }

    async function start() {
        return runExclusive(async () => {
            const status = await apiClient.getStatus();

            if (status.state === 'online') {
                return 'already-online';
            }

            if (status.state !== 'offline') {
                throw new Error(t('controller.startStateUnknown'));
            }

            await startOfflineServer();
            return 'started';
        });
    }

    async function stop() {
        return runExclusive(async () => {
            const status = await apiClient.getStatus();

            if (status.state === 'offline') {
                return 'already-offline';
            }

            if (status.state !== 'online') {
                throw new Error(t('controller.stopStateUnknown'));
            }

            await saveAndStopOnlineServer();
            return 'stopped';
        });
    }

    async function save() {
        return runExclusive(async () => {
            const status = await apiClient.getStatus();

            if (status.state !== 'online') {
                throw new Error(t('controller.saveStateUnknown'));
            }

            await apiClient.save();
            return 'saved';
        });
    }

    async function restart() {
        return runExclusive(async () => {
            const status = await apiClient.getStatus();

            if (status.state !== 'online') {
                throw new Error(t('controller.restartStateUnknown'));
            }

            await saveAndStopOnlineServer();
            await startOfflineServer();
            return 'restarted';
        });
    }

    async function announce(message) {
        return runExclusive(async () => {
            const announcement = typeof message === 'string'
                ? message.trim()
                : '';

            if (!announcement) {
                throw new Error(t('controller.announcementEmpty'));
            }

            if (announcement.length > 500) {
                throw new Error(t('controller.announcementTooLong', {
                    maxLength: 500
                }));
            }

            const status = await apiClient.getStatus();

            if (status.state !== 'online') {
                throw new Error(t('controller.announcementStateUnknown'));
            }

            await apiClient.announce(announcement);
            return 'announced';
        });
    }

    async function getLinuxGsmUpdateStatus() {
        try {
            const [scriptContent, response] = await Promise.all([
                commandExecutor.readFile(linuxGsm.script, 'utf8'),
                fetch(
                    'https://api.github.com/repos/GameServerManagers/LinuxGSM/releases/latest',
                    {
                        headers: {
                            Accept: 'application/vnd.github+json',
                            'User-Agent': 'palworld-command-bot'
                        },
                        signal: AbortSignal.timeout(10_000)
                    }
                )
            ]);

            if (!response.ok) {
                throw new Error(t('controller.linuxGsmReleaseHttpError', {
                    status: response.status
                }));
            }

            const release = await response.json();
            const localMatch = scriptContent.match(
                /^\s*version\s*=\s*["']?v?(\d+(?:\.\d+){1,2})/m
            );
            const installedVersion = normalizeVersion(localMatch?.[1]);
            const latestVersion = normalizeVersion(release.tag_name);

            if (!installedVersion || !latestVersion) {
                throw new Error(t('controller.linuxGsmVersionUnknown'));
            }

            return {
                installedVersion,
                latestVersion,
                updateAvailable: isNewerVersion(
                    installedVersion,
                    latestVersion
                )
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    async function checkUpdates() {
        return runExclusive(async () => {
            const [palworld, linuxGsmStatus] = await Promise.all([
                runLinuxGsmCommand('check-update'),
                getLinuxGsmUpdateStatus()
            ]);

            const palworldOutput = [palworld.stdout, palworld.stderr]
                .filter(Boolean)
                .join('\n')
                .trim();

            return {
                linuxGsm: linuxGsmStatus,
                palworldOutput,
                palworldUpdateAvailable: isPalworldUpdateAvailable(
                    palworldOutput
                )
            };
        });
    }

    async function applyUpdates() {
        return runExclusive(async () => {
            const linuxGsmUpdate = await runLinuxGsmCommand('update-lgsm');
            const palworldUpdate = await runLinuxGsmCommand('update');

            return {
                linuxGsmOutput: [
                    linuxGsmUpdate.stdout,
                    linuxGsmUpdate.stderr
                ].filter(Boolean).join('\n').trim(),
                palworldOutput: [
                    palworldUpdate.stdout,
                    palworldUpdate.stderr
                ].filter(Boolean).join('\n').trim()
            };
        });
    }

    return {
        announce,
        applyUpdates,
        checkUpdates,
        isBusy: () => actionRunning,
        restart,
        save,
        start,
        stop
    };
}

module.exports = {
    ServerActionBusyError,
    createServerController,
    isPalworldUpdateAvailable
};
