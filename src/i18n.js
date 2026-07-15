const path = require('node:path');

const defaultLocale = 'en';
let activeLocale = defaultLocale;
let messages = require('./locales/en.js');

function normalizeLocale(locale) {
    const normalized = String(locale || '')
        .trim()
        .toLowerCase();

    return /^[a-z]{2}(?:-[a-z]{2})?$/.test(normalized)
        ? normalized
        : defaultLocale;
}

function setLocale(locale) {
    const requestedLocale = normalizeLocale(locale);
    const localePath = path.join(
        __dirname,
        'locales',
        `${requestedLocale}.js`
    );

    try {
        messages = require(localePath);
        activeLocale = requestedLocale;
    } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') {
            throw error;
        }

        messages = require('./locales/en.js');
        activeLocale = defaultLocale;
    }

    return activeLocale;
}

function getLocale() {
    return activeLocale;
}

function t(key, placeholders = {}) {
    const template = messages[key];

    if (typeof template !== 'string') {
        throw new Error(
            messages['i18n.missingKey'].replace('{key}', key)
        );
    }

    return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) => {
        if (!Object.prototype.hasOwnProperty.call(placeholders, name)) {
            return match;
        }

        return String(placeholders[name]);
    });
}

module.exports = {
    getLocale,
    setLocale,
    t
};
