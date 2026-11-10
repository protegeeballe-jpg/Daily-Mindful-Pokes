/**
 * Backend-neutral rules for the upcoming no-email account system.
 *
 * This module intentionally has no storage, network, DOM, or authentication
 * side effects. It does not create accounts or persist credentials. The
 * account service must perform password/answer verification, rate limiting,
 * and recovery-key operations on the server.
 */

export const ACCOUNT_PASSWORD_LENGTH = 6;

export const ACCOUNT_SECURITY_QUESTIONS = Object.freeze([
    Object.freeze({ id: 1, text: 'What is the name of the first church, chapel, or spiritual community you regularly attended?' }),
    Object.freeze({ id: 2, text: 'What book (other than religious texts) profoundly shaped your worldview during childhood?' }),
    Object.freeze({ id: 3, text: 'What was the name of the first mentor or spiritual guide who influenced your path?' }),
    Object.freeze({ id: 4, text: 'What city or town was your paternal grandfather born in?' }),
    Object.freeze({ id: 5, text: 'What was the exact name of your favorite childhood pet?' }),
    Object.freeze({ id: 6, text: 'What is your all-time favorite verse, quote, or proverb that guides your daily discipline?' }),
    Object.freeze({ id: 7, text: "What was the make and model of your family's first car?" }),
    Object.freeze({ id: 8, text: 'What street did you live on when you experienced your most significant personal realization?' }),
    Object.freeze({ id: 9, text: 'What was the name of the elementary school you attended for the longest duration?' }),
    Object.freeze({ id: 10, text: "What is your mother's middle name?" }),
    Object.freeze({ id: 11, text: 'What instrument, if any, did you learn to play first?' }),
    Object.freeze({ id: 12, text: 'What was the primary subject or theme of the first journal or notebook you ever filled?' }),
    Object.freeze({ id: 13, text: 'What traditional dish or meal represents your earliest childhood memory of home?' }),
    Object.freeze({ id: 14, text: 'What is the name of the body of water (river, lake, ocean) closest to where you grew up?' }),
    Object.freeze({ id: 15, text: 'What specific outdoor location or sanctuary do you consider your place of deepest reflection?' }),
    Object.freeze({ id: 16, text: 'What was your childhood nickname given by your family?' }),
    Object.freeze({ id: 17, text: 'What professional title or trade did your grandfather hold?' }),
    Object.freeze({ id: 18, text: 'What was the title of the first album, cassette, or record you ever purchased or owned?' }),
    Object.freeze({ id: 19, text: 'What historical figure do you find most intellectually or spiritually compelling?' }),
    Object.freeze({ id: 20, text: 'What specific virtue or principle do you value above all others in your daily practice?' })
]);

const QUESTION_IDS = new Set(ACCOUNT_SECURITY_QUESTIONS.map(question => question.id));

function normalizeQuestionId(value) {
    if (Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return NaN;
}

/**
 * Username policy: alphabetic characters only, with at least one uppercase
 * and one lowercase letter. Uniqueness must be enforced by the account API
 * using the case-insensitive lookup key returned here.
 */
export function normalizeUsernameForLookup(username) {
    return typeof username === 'string'
        ? username.normalize('NFKC').trim().toLowerCase()
        : '';
}

export function validateAccountUsername(username) {
    const value = typeof username === 'string' ? username.normalize('NFKC').trim() : '';
    const errors = [];

    if (!value) {
        errors.push('Enter a username.');
    } else {
        if (!/^[A-Za-z]+$/.test(value)) {
            errors.push('Use uppercase and lowercase letters only, with no spaces, numbers, or symbols.');
        }
        if (!/[A-Z]/.test(value)) {
            errors.push('Include at least one uppercase letter.');
        }
        if (!/[a-z]/.test(value)) {
            errors.push('Include at least one lowercase letter.');
        }
    }

    return {
        valid: errors.length === 0,
        value,
        lookupKey: normalizeUsernameForLookup(value),
        errors
    };
}

/**
 * Password policy: exactly six visible ASCII characters, including at least
 * one uppercase letter, one lowercase letter, one number, and one symbol.
 * The account password is distinct from the existing local device PIN.
 */
export function getAccountPasswordChecks(password) {
    const value = typeof password === 'string' ? password : '';
    return {
        exactlySixCharacters: value.length === ACCOUNT_PASSWORD_LENGTH
            && /^[\x21-\x7E]{6}$/.test(value),
        hasUppercase: /[A-Z]/.test(value),
        hasLowercase: /[a-z]/.test(value),
        hasNumber: /[0-9]/.test(value),
        hasSpecialCharacter: /[^A-Za-z0-9\s]/.test(value),
        hasNoWhitespace: !/\s/.test(value)
    };
}

export function validateAccountPassword(password) {
    const checks = getAccountPasswordChecks(password);
    const errors = [];

    if (!checks.exactlySixCharacters) {
        errors.push('Use exactly 6 characters. Choose visible characters and do not use spaces.');
    }
    if (!checks.hasUppercase) errors.push('Include at least one uppercase letter (A–Z).');
    if (!checks.hasLowercase) errors.push('Include at least one lowercase letter (a–z).');
    if (!checks.hasNumber) errors.push('Include at least one number (0–9).');
    if (!checks.hasSpecialCharacter) errors.push('Include at least one special character (such as !, @, or #).');

    return { valid: errors.length === 0, checks, errors };
}

/**
 * Return exactly three distinct valid question IDs. IDs may arrive as strings
 * from HTML select controls or as numbers from application code.
 */
export function validateSecurityQuestionSelection(selectedIds) {
    if (!Array.isArray(selectedIds) || selectedIds.length !== 3) {
        return { valid: false, questionIds: [], errors: ['Choose exactly 3 security questions.'] };
    }

    const questionIds = selectedIds.map(normalizeQuestionId);
    const errors = [];

    if (questionIds.some(id => !QUESTION_IDS.has(id))) {
        errors.push('Choose questions from the provided list.');
    }
    if (new Set(questionIds).size !== 3) {
        errors.push('Choose 3 different questions.');
    }

    return {
        valid: errors.length === 0,
        questionIds: errors.length === 0 ? questionIds : [],
        errors
    };
}

/**
 * Normalize answers deterministically: Unicode-normalize, lowercase, and
 * remove whitespace and punctuation. The normalized answer is still a
 * low-entropy user input, not a cryptographic key. The future account
 * service must use a vetted password-hashing function (e.g. Argon2id), unique
 * salts, rate limits, and a separate high-entropy Diary recovery mechanism.
 */
export function normalizeSecurityAnswer(answer) {
    if (typeof answer !== 'string') return '';
    return answer
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\p{P}\p{Z}]+/gu, '');
}

export function validateSecurityAnswers(answers) {
    if (!Array.isArray(answers) || answers.length !== 3) {
        return { valid: false, answers: [], errors: ['Provide answers to all 3 selected questions.'] };
    }

    const errors = [];
    const normalized = answers.map(item => ({
        questionId: normalizeQuestionId(item?.questionId),
        answer: normalizeSecurityAnswer(item?.answer)
    }));

    if (normalized.some(item => !QUESTION_IDS.has(item.questionId))) {
        errors.push('Each answer must match a question from the provided list.');
    }
    if (new Set(normalized.map(item => item.questionId)).size !== 3) {
        errors.push('Each answer must belong to a different question.');
    }
    if (normalized.some(item => !item.answer)) {
        errors.push('Answer all 3 security questions.');
    }

    return {
        valid: errors.length === 0,
        answers: errors.length === 0 ? normalized : [],
        errors
    };
}
