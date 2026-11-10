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
    Object.freeze({ id: 1, text: 'What was the name of your first school?' }),
    Object.freeze({ id: 2, text: 'What was the nickname you had as a child?' }),
    Object.freeze({ id: 3, text: 'What was the name of your childhood best friend?' }),
    Object.freeze({ id: 4, text: 'What was the first name of your favorite teacher?' }),
    Object.freeze({ id: 5, text: 'What was the name of your first pet?' }),
    Object.freeze({ id: 6, text: 'What was your childhood favorite cartoon?' }),
    Object.freeze({ id: 7, text: 'What was the first book you remember reading?' }),
    Object.freeze({ id: 8, text: 'What was the first concert or live show you attended?' }),
    Object.freeze({ id: 9, text: 'What was the name of the street where you grew up?' }),
    Object.freeze({ id: 10, text: 'What was the name of your favorite childhood playground?' }),
    Object.freeze({ id: 11, text: 'What was the first dish you learned to cook?' }),
    Object.freeze({ id: 12, text: 'What was your favorite subject in school?' }),
    Object.freeze({ id: 13, text: 'What was the name of your favorite childhood toy?' }),
    Object.freeze({ id: 14, text: 'What was the first movie you watched in a cinema?' }),
    Object.freeze({ id: 15, text: 'What was the name of your first sports team?' }),
    Object.freeze({ id: 16, text: 'What was your favorite childhood game?' }),
    Object.freeze({ id: 17, text: 'What was the first country you wanted to visit?' }),
    Object.freeze({ id: 18, text: 'What was the name of your childhood neighbor or playmate?' }),
    Object.freeze({ id: 19, text: 'What was your favorite family holiday tradition?' }),
    Object.freeze({ id: 20, text: 'What was the first musical instrument you wanted to learn?' })
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
 * Normalize an answer consistently before the server applies its password
 * hashing function. Never store or log the returned normalized value in
 * plaintext. Security-answer verification and throttling belong on the
 * authenticated account service.
 */
export function normalizeSecurityAnswer(answer) {
    if (typeof answer !== 'string') return '';
    return answer
        .normalize('NFKC')
        .trim()
        .replace(/\s+/gu, ' ')
        .toLowerCase();
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
