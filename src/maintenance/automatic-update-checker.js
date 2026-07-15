const { ServerActionBusyError } = require('../palworld/server-controller.js');

function createAutomaticUpdateChecker({
    serverController,
    auditLogger,
    ownerUserId,
    onError = () => {}
}) {
    let checkRunning = false;
    let lastNotificationSignature = null;
    let lastErrorMessage = null;

    function getUpdateSignature(result) {
        const linuxGsmUpdateAvailable =
            result.linuxGsm.updateAvailable === true;

        if (!result.palworldUpdateAvailable && !linuxGsmUpdateAvailable) {
            return null;
        }

        return JSON.stringify({
            palworld: result.palworldUpdateAvailable,
            linuxGsm: linuxGsmUpdateAvailable
                ? result.linuxGsm.latestVersion
                : null
        });
    }

    async function check() {
        if (checkRunning) {
            return { checked: false, reason: 'busy' };
        }

        checkRunning = true;

        try {
            const result = await serverController.checkUpdates();
            const signature = getUpdateSignature(result);

            lastErrorMessage = null;

            if (!signature) {
                lastNotificationSignature = null;
                return { checked: true, updateAvailable: false, result };
            }

            if (signature === lastNotificationSignature) {
                return {
                    checked: true,
                    updateAvailable: true,
                    notified: false,
                    result
                };
            }

            const notification = await auditLogger.notifyUpdateAvailable({
                ownerUserId,
                result
            });

            if (notification.sent) {
                lastNotificationSignature = signature;
            }

            return {
                checked: true,
                updateAvailable: true,
                notified: notification.sent,
                result
            };
        } catch (error) {
            if (error instanceof ServerActionBusyError) {
                return { checked: false, reason: 'server-busy' };
            }

            if (error.message !== lastErrorMessage) {
                lastErrorMessage = error.message;
                await auditLogger.log({
                    action: 'automaticUpdateCheck',
                    outcome: 'failed',
                    error
                });
                await onError(error);
            }

            return { checked: false, reason: 'error', error };
        } finally {
            checkRunning = false;
        }
    }

    return { check };
}

module.exports = {
    createAutomaticUpdateChecker
};
