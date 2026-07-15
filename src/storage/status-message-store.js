const fs = require('node:fs/promises');
const { t } = require('../i18n.js');

function createStatusMessageStore(filePath) {
    async function read() {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const state = JSON.parse(content);
            return typeof state.messageId === 'string' ? state.messageId : null;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(
                    t('log.statusMessageReadFailed'),
                    error
                );
            }

            return null;
        }
    }

    async function save(messageId) {
        await fs.writeFile(
            filePath,
            JSON.stringify({ messageId }, null, 2),
            { encoding: 'utf8', mode: 0o600 }
        );
    }

    return { read, save };
}

module.exports = {
    createStatusMessageStore
};
