import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ACCOUNT_PASSWORD_LENGTH,
    ACCOUNT_SECURITY_QUESTIONS,
    getAccountPasswordChecks,
    normalizeSecurityAnswer,
    normalizeUsernameForLookup,
    validateAccountPassword,
    validateAccountUsername,
    validateSecurityAnswers,
    validateSecurityQuestionSelection
} from '../assets/account-security.js';

test('the security-question bank contains 20 stable, unique questions', () => {
    assert.equal(ACCOUNT_SECURITY_QUESTIONS.length, 20);
    assert.deepEqual(
        ACCOUNT_SECURITY_QUESTIONS.map(question => question.id),
        Array.from({ length: 20 }, (_, index) => index + 1)
    );
    assert.equal(new Set(ACCOUNT_SECURITY_QUESTIONS.map(question => question.text)).size, 20);
    assert.ok(ACCOUNT_SECURITY_QUESTIONS.every(question => question.text.endsWith('?')));
});

test('username requires uppercase and lowercase letters only', () => {
    assert.equal(validateAccountUsername('FaithFocus').valid, true);
    assert.equal(validateAccountUsername('FAITHFOCUS').valid, false);
    assert.equal(validateAccountUsername('faithfocus').valid, false);
    assert.equal(validateAccountUsername('Faith Focus').valid, false);
    assert.equal(validateAccountUsername('Faith2026').valid, false);
    assert.equal(validateAccountUsername('Faith!').valid, false);
    assert.equal(validateAccountUsername('').valid, false);
});

test('username lookup keys are case-insensitive and Unicode-normalized', () => {
    assert.equal(normalizeUsernameForLookup(' FaithFocus '), 'faithfocus');
    assert.equal(normalizeUsernameForLookup('FAITHFOCUS'), 'faithfocus');
});

test('account password follows the exact six-character policy', () => {
    assert.equal(ACCOUNT_PASSWORD_LENGTH, 6);
    assert.equal(validateAccountPassword('Ab3!xy').valid, true);
    assert.equal(validateAccountPassword('Ab3!x').valid, false);
    assert.equal(validateAccountPassword('Ab3!xyz').valid, false);
    assert.equal(validateAccountPassword('abcdef').valid, false);
    assert.equal(validateAccountPassword('ABC123').valid, false);
    assert.equal(validateAccountPassword('Abc! 1').valid, false);
    assert.equal(validateAccountPassword('Abc!é1').valid, false);
});

test('password requirement checks expose each criterion for accessible UI feedback', () => {
    const checks = getAccountPasswordChecks('Ab3!xy');
    assert.deepEqual(checks, {
        exactlySixCharacters: true,
        hasUppercase: true,
        hasLowercase: true,
        hasNumber: true,
        hasSpecialCharacter: true,
        hasNoWhitespace: true
    });
});

test('registration requires exactly three distinct security questions', () => {
    assert.equal(validateSecurityQuestionSelection([1, 5, 20]).valid, true);
    assert.equal(validateSecurityQuestionSelection(['1', '5', '20']).valid, true);
    assert.equal(validateSecurityQuestionSelection([1, 1, 20]).valid, false);
    assert.equal(validateSecurityQuestionSelection([1, 5]).valid, false);
    assert.equal(validateSecurityQuestionSelection([1, 5, 21]).valid, false);
    assert.equal(validateSecurityQuestionSelection([1, 'x', 20]).valid, false);
});

test('security answers are normalized consistently without allowing missing answers', () => {
    assert.equal(normalizeSecurityAnswer('  BLUE   House  '), 'blue house');
    assert.equal(normalizeSecurityAnswer('ＢＬＵＥ House'), 'blue house');
    assert.equal(validateSecurityAnswers([
        { questionId: 1, answer: 'Green Hill' },
        { questionId: 2, answer: 'Little Star' },
        { questionId: 3, answer: 'Sunday' }
    ]).valid, true);
    assert.equal(validateSecurityAnswers([
        { questionId: 1, answer: 'Green Hill' },
        { questionId: 2, answer: '   ' },
        { questionId: 3, answer: 'Sunday' }
    ]).valid, false);
    assert.equal(validateSecurityAnswers([
        { questionId: 1, answer: 'Green Hill' },
        { questionId: 1, answer: 'Little Star' },
        { questionId: 3, answer: 'Sunday' }
    ]).valid, false);
});
